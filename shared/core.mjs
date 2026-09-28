// Logic shared by the local Node server (scripts/import-job-api.mjs) and the
// Cloudflare Worker (worker/index.js). Nothing here may import Node modules.

export const PARTS = new Set(["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"]);
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const ANALYZE_PROMPT = "Identify every distinct wearable clothing item visible in this image. A photo may show one isolated garment or a person wearing several items. Return one record per actual item that should enter a wardrobe, at most 8. Ignore the person's body and non-wearable background objects. For each item, include a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image: x and y are the top-left corner, followed by width and height. Boxes may overlap when garments overlap, but each box must focus on one distinct item. Use only these category ids: upperbody (tops), wholebody_up (jackets and outer layers), lowerbody (bottoms), accessories_up (accessories), shoes. Suggest a concise specific name, the primary color as a six-digit hex such as #1f2a44, a genuinely distinct secondary hex color or null, and 1-4 useful lowercase detail tags. Return an empty list when there is no clothing.";

// Claude structured outputs accept a subset of JSON Schema, so ranges and
// patterns are checked afterwards by normalizeMetadata instead.
const BOX_SCHEMA = { type: "object", additionalProperties: false, properties: { x: { type: "integer" }, y: { type: "integer" }, width: { type: "integer" }, height: { type: "integer" } }, required: ["x", "y", "width", "height"] };
export const ANALYZE_SCHEMA = { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, part: { type: "string", enum: [...PARTS] }, color: { type: "string" }, secondaryColor: { anyOf: [{ type: "string" }, { type: "null" }] }, tags: { type: "array", items: { type: "string" } }, boundingBox: BOX_SCHEMA }, required: ["name", "part", "color", "secondaryColor", "tags", "boundingBox"] } } }, required: ["items"] };

export const STYLE_SCHEMA = { type: "object", additionalProperties: false, properties: { outfits: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, occasion: { type: "array", items: { type: "string" } }, garmentIds: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["name", "occasion", "garmentIds", "reason"] } } }, required: ["outfits"] };

export const MAX_STYLE_COUNT = 12;

export function buildStylePrompt({ items, outfits = [], count = 4, notes = "" }) {
  const closet = items.map((item) => ({ id: item.id, name: item.name, category: item.part, color: item.color, secondaryColor: item.secondaryColor || undefined, tags: item.tags }));
  const taken = outfits.map((outfit) => outfit.garmentIds).filter(Array.isArray);
  return `You are styling outfits from this wardrobe. Every piece is listed as JSON with its id, name, category, colors and tags.

Categories: upperbody = tops, lowerbody = bottoms, wholebody_up = jackets and outer layers, shoes, accessories_up = accessories.

<wardrobe>
${JSON.stringify(closet)}
</wardrobe>

Create ${count} new outfits. Each outfit uses exactly one upperbody piece and one lowerbody piece, and may add one outer layer, one pair of shoes and one accessory. Use only ids from the wardrobe. Do not repeat any of these existing combinations: ${JSON.stringify(taken)}.

Styling rules:
- Favor tonal or nearby colors for a calm look, and use contrast on purpose with one color in charge.
- Let one pattern, graphic, texture or bright piece carry the look.
- Balance the shapes: pair fuller bottoms with a cleaner top, and keep heavy layers over a simple base.
- Spread the pieces across outfits instead of leaning on the same easy basics.
- Cover a useful mix of occasions such as casual, smart casual, work, evening and warm or cold weather.
${notes ? `
The owner asked for: ${notes}
` : ""}
Give each outfit a short name (two to four words), one to three lowercase occasion tags, the garment ids, and one plain sentence on why it works. If the wardrobe cannot support ${count} distinct outfits, return as many good ones as it can.`;
}

// Keep only outfits that use real pieces, have a top and a bottom, and do not
// repeat a combination we already have.
export function normalizeStyledOutfits(value, items, existing = []) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set(existing.map((outfit) => [...(outfit.garmentIds || [])].sort().join("|")));
  const list = Array.isArray(value?.outfits) ? value.outfits : [];
  const result = [];
  for (const outfit of list) {
    const ids = [...new Set((Array.isArray(outfit?.garmentIds) ? outfit.garmentIds : []).filter((id) => byId.has(id)))];
    const parts = ids.map((id) => byId.get(id).part);
    if (!parts.includes("upperbody") || !parts.includes("lowerbody")) continue;
    const key = [...ids].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const name = typeof outfit.name === "string" && outfit.name.trim() ? outfit.name.trim().slice(0, 80) : "New outfit";
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "outfit";
    result.push({
      id: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
      name,
      occasion: (Array.isArray(outfit.occasion) ? outfit.occasion : []).filter((tag) => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 3),
      garmentIds: ids,
      reason: typeof outfit.reason === "string" ? outfit.reason.trim().slice(0, 400) : "",
      image: null,
      createdAt: new Date().toISOString(),
    });
  }
  return result;
}

function outfitOccasions(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list.filter((tag) => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 4);
}

// An outfit someone put together by hand in the app.
export function normalizeManualOutfit(input = {}, items = []) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = [...new Set((Array.isArray(input?.garmentIds) ? input.garmentIds : []).filter((id) => byId.has(id)))];
  if (ids.length < 2) throw Object.assign(new Error("Pick at least two pieces for an outfit."), { status: 400 });
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : "My outfit";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "outfit";
  return {
    id: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
    name,
    occasion: outfitOccasions(input.occasion),
    garmentIds: ids,
    reason: typeof input.reason === "string" ? input.reason.trim().slice(0, 400) : "",
    image: null,
    createdAt: new Date().toISOString(),
  };
}

// Applies a name, occasion or note change to a saved outfit. Pieces and the
// id never change here.
export function applyOutfitEdit(current, input = {}) {
  const next = { ...current };
  if (typeof input.name === "string" && input.name.trim()) next.name = input.name.trim().slice(0, 80);
  if (input.occasion !== undefined) next.occasion = outfitOccasions(input.occasion);
  if (typeof input.reason === "string") next.reason = input.reason.trim().slice(0, 400);
  return next;
}

export function isLoopbackHost(host = "") {
  const value = String(host).trim().toLowerCase();
  const hostname = value.startsWith("[")
    ? value.slice(0, value.indexOf("]") + 1)
    : value.split(":").length > 2 ? value : value.split(":")[0];
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

export function tokensMatch(expected, actual) {
  if (!expected || typeof actual !== "string" || expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return difference === 0;
}

export function publicJob(job) {
  const copy = structuredClone(job);
  delete copy.internal;
  return copy;
}

export function normalizeMetadata(value = {}) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const color = typeof metadata.color === "string" && HEX_COLOR.test(metadata.color) ? metadata.color.toLowerCase() : "#d8d0c2";
  const secondaryColor = typeof metadata.secondaryColor === "string" && HEX_COLOR.test(metadata.secondaryColor) ? metadata.secondaryColor.toLowerCase() : null;
  return {
    name: typeof metadata.name === "string" ? metadata.name.trim().slice(0, 120) || "New piece" : "New piece",
    part: PARTS.has(metadata.part) ? metadata.part : "upperbody",
    color,
    secondaryColor,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
    boundingBox: normalizeBoundingBox(metadata.boundingBox),
  };
}

export function normalizeItemEdit(record, value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = { ...record };
  if ("name" in input) next.name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : record.name;
  if ("part" in input) {
    if (!PARTS.has(input.part)) throw Object.assign(new Error("Unknown category"), { status: 400 });
    next.part = input.part;
  }
  if ("color" in input) {
    if (typeof input.color !== "string" || !HEX_COLOR.test(input.color)) throw Object.assign(new Error("color must be a hex color"), { status: 400 });
    next.color = input.color.toLowerCase();
  }
  if ("secondaryColor" in input) {
    if (input.secondaryColor === null || input.secondaryColor === "") next.secondaryColor = null;
    else if (typeof input.secondaryColor === "string" && HEX_COLOR.test(input.secondaryColor)) next.secondaryColor = input.secondaryColor.toLowerCase();
    else throw Object.assign(new Error("secondaryColor must be a hex color or null"), { status: 400 });
  }
  if ("tags" in input) {
    if (!Array.isArray(input.tags)) throw Object.assign(new Error("tags must be an array"), { status: 400 });
    next.tags = [...new Set(input.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  }
  next.palette = [...new Set([next.color, next.secondaryColor, ...(Array.isArray(record.palette) ? record.palette : [])].filter(Boolean))].slice(0, 5);
  return next;
}

export function normalizeBoundingBox(value = {}) {
  const box = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = (key, fallback) => Number.isFinite(Number(box[key])) ? Math.round(Number(box[key])) : fallback;
  const x = Math.max(0, Math.min(999, number("x", 0)));
  const y = Math.max(0, Math.min(999, number("y", 0)));
  const width = Math.max(1, Math.min(1000 - x, number("width", 1000 - x)));
  const height = Math.max(1, Math.min(1000 - y, number("height", 1000 - y)));
  return { x, y, width, height };
}

export function stageState() {
  return { status: "pending", decision: null, attempts: 0, assetUrl: null, error: null, updatedAt: null };
}
