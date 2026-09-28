// Logic shared by the local Node server (scripts/import-job-api.mjs) and the
// Cloudflare Worker (worker/index.js). Nothing here may import Node modules.

export const PARTS = new Set(["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"]);
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const ANALYZE_PROMPT = "Identify every distinct wearable clothing item visible in this image. A photo may show one isolated garment or a person wearing several items. Return one record per actual item that should enter a wardrobe. Ignore the person's body and non-wearable background objects. For each item, include a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image: x and y are the top-left corner, followed by width and height. Boxes may overlap when garments overlap, but each box must focus on one distinct item. Use only these category ids: upperbody, wholebody_up, lowerbody, accessories_up, shoes. Suggest a concise specific name, primary hex color, optional genuinely distinct secondary hex color, and 1-4 useful lowercase detail tags.";

export const ANALYZE_SCHEMA = { type: "object", additionalProperties: false, properties: { items: { type: "array", minItems: 0, maxItems: 8, items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, part: { type: "string", enum: ["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"] }, color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, secondaryColor: { anyOf: [{ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, { type: "null" }] }, tags: { type: "array", items: { type: "string" }, maxItems: 4 }, boundingBox: { type: "object", additionalProperties: false, properties: { x: { type: "integer", minimum: 0, maximum: 999 }, y: { type: "integer", minimum: 0, maximum: 999 }, width: { type: "integer", minimum: 1, maximum: 1000 }, height: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["x", "y", "width", "height"] } }, required: ["name", "part", "color", "secondaryColor", "tags", "boundingBox"] } } }, required: ["items"] };

export const MODELED_PROMPT = "Create a professional horizontal 3:2 editorial fashion photograph of the person in Image 1 wearing the exact garment from Image 2. Preserve the person's recognizable identity, face, hair, age and proportions. Preserve every garment color, material, fit, construction, graphic, logo and distinctive detail. Keep the complete featured item clearly visible and unobstructed, use understated neutral supporting clothes, realistic anatomy, natural light, authentic fabric, a tasteful real-world setting, and leave environmental space around the model. No text, watermark, product mockup, or synthetic appearance.";

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

export function chooseChromaKey(primary = "#808080") {
  const value = HEX_COLOR.test(primary) ? primary : "#808080";
  const source = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const candidates = [[0, 255, 0], [255, 0, 255], [0, 255, 255]];
  const selected = candidates.sort((a, b) => {
    const distance = (color) => color.reduce((total, channel, index) => total + ((channel - source[index]) ** 2), 0);
    return distance(b) - distance(a);
  })[0];
  return `#${selected.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function buildGarmentPrompt(metadata = {}, chromaKey = "#00ff00") {
  const name = metadata.name || "clothing item";
  const category = metadata.part || "wardrobe item";
  const primary = metadata.color || "the exact visible color";
  const secondary = metadata.secondaryColor ? ` with distinct secondary color ${metadata.secondaryColor}` : "";
  const details = Array.isArray(metadata.tags) && metadata.tags.length
    ? metadata.tags.join(", ")
    : "all visible construction and design details";

  return `Use case: background-extraction
Asset type: ecommerce catalog product cutout source

Input image: The reference photograph shows the exact garment, either by itself or worn by a person. Use it only to identify and reconstruct the garment.

Primary request: Reconstruct ONLY the complete empty ${name} (${category}) as a clean, front-facing ecommerce catalog product photograph. If a wearer is present, remove them. Remove every other garment, object, and background element. Show the complete item naturally arranged and symmetrical, with no person, body, mannequin, or hanger visible.

Garment fidelity: Preserve the reference garment's exact primary color ${primary}${secondary}, material and texture, silhouette, neckline, sleeves, fastenings, pattern, and distinctive details (${details}). Preserve any clearly legible existing graphic or logo exactly, but do not invent or reinterpret uncertain logos, text, pockets, seams, hardware, colors, or decoration.

Composition: Centered straight-on product view. Keep the entire garment inside the frame with generous, even padding on every side. No cropping or truncation.

Background: Perfectly flat, absolutely uniform solid ${chromaKey} chroma-key color, edge-to-edge. No shadows, gradient, texture, vignette, floor, horizon, reflection, or lighting variation.

Lighting: Neutral diffuse product lighting contained on the garment only.

Avoid: person, body, skin, hair, mannequin, hanger, props, other garments, retail tags, cast shadow, contact shadow, reflection, watermark, caption, border, background variation, or chroma spill.

Critical: Use no ${chromaKey} anywhere in the garment. Produce exactly one complete garment with a crisp, separable outer silhouette.`;
}

export function cleanupTolerance(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(18, Math.min(110, Math.round(parsed))) : 46;
}

export function stageState() {
  return { status: "pending", decision: null, attempts: 0, assetUrl: null, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupTolerance: 46, cleanupDiagnostics: null, error: null, prompt: null, updatedAt: null };
}
