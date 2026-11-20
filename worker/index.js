// Cloudflare Worker version of the wardrobe API (see scripts/import-job-api.mjs
// for the local Node version). Images live in R2, records in D1, the AI picked
// in Settings (Claude, ChatGPT or Gemini) finds and styles the clothes, and Cloudflare Images cuts each garment out of its
// background from a Queue so requests return right away.
import {
  MAX_STYLE_COUNT,
  allowedOrigin,
  canMakeOutfit,
  styleOptions,
  checkPng,
  garmentFileName,
  newPieceRecord,
  sortFields,
  applyOutfitEdit,
  normalizeItemEdit,
  normalizeManualOutfit,
  normalizeMetadata,
  publicJob,
  stageState,
  imageKeyMatches,
  newImageKey,
  tokensMatch,
} from "../shared/core.mjs";
import { normalizePlan } from "../shared/style.mjs";
import { AI_IMAGE_EDGE, AiError, applyAiSettingsEdit, detectClothing, publicAiSettings, requireAi, resolveAi, sortCloset, styleOutfits } from "../shared/ai.mjs";
import packageInfo from "../package.json" with { type: "json" };
import { cropDetectedItem, decodePng, encodePng, frameTransparentGarment, resize } from "../shared/pixels.mjs";

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
const MAX_BODY = 25 * 1024 * 1024;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const MAX_QUEUE_ATTEMPTS = 3;
const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_FAILURES = 20;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

// Per-isolate brute-force throttle on failed WARDROBE_TOKEN attempts.
const authFailures = new Map();

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

// Names the caller's origin on the answer when it is one we allow (see
// allowedOrigin). The open health check stays open to all.
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = new URL(request.url).pathname === "/api/health" ? "*" : allowedOrigin(request.headers.get("origin"), env.WARDROBE_CORS_ORIGINS);
  headers.append("Vary", "Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  else for (const name of Object.keys(CORS_HEADERS)) headers.delete(name);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function setting(env, name, fallback = "") {
  return (typeof env?.[name] === "string" && env[name].trim()) || fallback;
}

// The allowed methods and headers. withCors names the origin, or takes
// these away when the caller's origin is not allowed.
function corsHeaders() {
  return { ...CORS_HEADERS };
}

function json(status, value, cors = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...cors,
      ...extraHeaders,
    },
  });
}

function requireJsonContentType(request) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Send request body as application/json");
  }
}

async function readJson(request, limit = MAX_BODY) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new HttpError(413, "Request body too large");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, "Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) return {};
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(combined);
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Expected a JSON request body"); }
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function checkAuthRateLimit(key, now = Date.now()) {
  const entry = authFailures.get(key);
  if (!entry) return null;
  if (now >= entry.resetAt) {
    authFailures.delete(key);
    return null;
  }
  if (entry.count >= AUTH_MAX_FAILURES) {
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }
  return null;
}

function recordAuthFailure(key, now = Date.now()) {
  if (authFailures.size > 500) {
    for (const [ip, entry] of authFailures) {
      if (now >= entry.resetAt) authFailures.delete(ip);
    }
  }
  const entry = authFailures.get(key);
  if (!entry || now >= entry.resetAt) {
    authFailures.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function isJpeg(bytes) {
  return bytes.length >= JPEG_MAGIC.length && JPEG_MAGIC.every((value, index) => bytes[index] === value);
}

function decodeDataUrl(input) {
  const raw = input.imageDataUrl || input.imageBase64;
  if (!raw || typeof raw !== "string") throw new HttpError(400, "imageDataUrl or imageBase64 is required");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = match?.[1] || input.mimeType || "image/png";
  const binary = atob(match?.[2] || raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) throw new HttpError(400, "Image payload is empty");
  return { bytes, mime };
}

function toBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

// The AI picked in Settings and the keys pasted there live in the D1
// settings table. Worker secrets (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) still work
// when nothing is saved.
async function loadAiSettings(env) {
  const row = await env.DB.prepare("SELECT data FROM settings WHERE key = 'ai'").first().catch(() => null);
  return row ? JSON.parse(row.data) : {};
}

async function saveAiSettings(env, value) {
  try {
    await env.DB.prepare("INSERT INTO settings (key, data) VALUES ('ai', ?1) ON CONFLICT(key) DO UPDATE SET data = excluded.data").bind(JSON.stringify(value)).run();
  } catch (error) {
    if (/no such table/i.test(error.message)) throw new HttpError(503, "Update the database first: run npm run cf:migrate, then try again.");
    throw error;
  }
}

const envReader = (env) => (name) => setting(env, name);

async function currentAi(env) {
  return resolveAi(await loadAiSettings(env), envReader(env));
}

// ---------- images ----------

async function transformImage(env, bytes, transform, format) {
  const result = await env.IMAGES.input(new Blob([bytes]).stream()).transform(transform).output({ format });
  return new Uint8Array(await result.response().arrayBuffer());
}

// The AI reads images up to 1568px on the long edge. Cloudflare Images makes
// a JPEG that size; without the binding (tests), fall back to a small PNG.
async function imageForAi(env, image, rawBytes) {
  if (env.IMAGES) {
    const jpeg = await transformImage(env, rawBytes, { width: AI_IMAGE_EDGE, height: AI_IMAGE_EDGE, fit: "scale-down" }, "image/jpeg");
    return { imageBase64: toBase64(jpeg), mediaType: "image/jpeg" };
  }
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const small = scale < 1 ? resize(image, Math.round(image.width * scale), Math.round(image.height * scale)) : image;
  return { imageBase64: toBase64(encodePng(small)), mediaType: "image/png" };
}

async function removeBackground(env, cropBytes) {
  if (!env.IMAGES) throw Object.assign(new Error("Background removal needs the Cloudflare Images binding. Use the crop as is, or add the binding."), { permanent: true });
  return transformImage(env, cropBytes, { segment: "foreground" }, "image/png");
}

// ---------- storage ----------

async function getObjectBytes(env, key) {
  const object = await env.BUCKET.get(key);
  if (!object) throw new HttpError(404, "Not found");
  return new Uint8Array(await object.arrayBuffer());
}

async function putPng(env, key, bytes) {
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
}

async function loadJob(env, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const row = await env.DB.prepare("SELECT data FROM jobs WHERE id = ?").bind(id).first();
  return row ? JSON.parse(row.data) : null;
}

async function saveJob(env, job) {
  job.updatedAt = new Date().toISOString();
  await env.DB.prepare("INSERT INTO jobs (id, data, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .bind(job.id, JSON.stringify(job), job.createdAt).run();
}

async function deleteJob(env, id) {
  const existing = await loadJob(env, id);
  await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
  let cursor;
  do {
    const listing = await env.BUCKET.list({ prefix: `jobs/${id}/`, cursor });
    if (listing.objects.length) await env.BUCKET.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  // Clean up shared multi-garment batch original once the last job in the batch is gone.
  const batchId = existing?.internal?.originalBatchId;
  if (batchId && batchId !== id) {
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE data LIKE ?").bind(`%${batchId}%`).first().catch(() => null);
    if (!remaining || Number(remaining.count) === 0) {
      await env.BUCKET.delete(`jobs/${batchId}/${existing.internal.originalFile || "original.png"}`).catch(() => {});
    }
  }
}

async function listItems(env) {
  const { results } = await env.DB.prepare("SELECT data FROM items ORDER BY position, created_at").all();
  return results.map((row) => JSON.parse(row.data));
}

async function upsertItem(env, record) {
  await env.DB.prepare(`INSERT INTO items (id, data, created_at, position) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), 0) + 1 FROM items))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(record.id, JSON.stringify(record), new Date().toISOString()).run();
}

async function listOutfits(env) {
  const { results } = await env.DB.prepare("SELECT data FROM outfits ORDER BY position, id").all();
  return results.map((row) => {
    const outfit = JSON.parse(row.data);
    const fileName = typeof outfit.image === "string" ? outfit.image.split("/").pop() : null;
    return { ...outfit, image: fileName ? `${OUTFIT_ASSET_ROOT}/${fileName}` : null };
  });
}

function assetName(url) {
  return new URL(url, "http://localhost").pathname.split("/").pop();
}

async function persistImported(env, job) {
  const id = `import-${job.id}`;
  const garmentName = `${id}-garment.png`;
  await putPng(env, `library/${garmentName}`, await getObjectBytes(env, `jobs/${job.id}/${assetName(job.stages.garment.assetUrl)}`));
  const metadata = job.metadata || {};
  const record = {
    id,
    name: metadata.name || "New piece",
    part: metadata.part || "upperbody",
    color: metadata.color || "#d8d0c2",
    secondaryColor: metadata.secondaryColor || null,
    palette: [metadata.color, metadata.secondaryColor].filter(Boolean),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    ...sortFields(metadata),
    image: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
    thumbnail: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
    importJobId: job.id,
    addedAt: new Date().toISOString(),
  };
  await upsertItem(env, record);
  return record;
}

async function saveOutfit(env, outfit) {
  await env.DB.prepare(`INSERT INTO outfits (id, data, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM outfits))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(outfit.id, JSON.stringify(outfit)).run();
}

// Prunes a deleted garment ID from all outfits, deleting any outfit left with
// fewer than 2 pieces and clearing deleted outfit IDs from the plan.
async function pruneDeletedGarment(env, garmentId) {
  const { results } = await env.DB.prepare("SELECT id, data FROM outfits").all();
  const statements = [];
  const removedOutfitIds = new Set();
  for (const row of results) {
    const outfit = JSON.parse(row.data);
    if (!Array.isArray(outfit.garmentIds) || !outfit.garmentIds.includes(garmentId)) continue;
    const nextIds = outfit.garmentIds.filter((id) => id !== garmentId);
    if (nextIds.length < 2) {
      removedOutfitIds.add(outfit.id);
      statements.push(env.DB.prepare("DELETE FROM outfits WHERE id = ?").bind(outfit.id));
    } else {
      const next = { ...outfit, garmentIds: nextIds };
      statements.push(env.DB.prepare("UPDATE outfits SET data = ? WHERE id = ?").bind(JSON.stringify(next), outfit.id));
    }
  }
  if (statements.length) await env.DB.batch(statements);
  if (removedOutfitIds.size) {
    await env.BUCKET.delete([...removedOutfitIds].map((id) => `outfits/${id}.png`)).catch(() => {});
    const planRow = await env.DB.prepare("SELECT data FROM settings WHERE key = 'plan'").first().catch(() => null);
    if (planRow) {
      const plan = normalizePlan(JSON.parse(planRow.data));
      let changed = false;
      for (const [day, outfitId] of Object.entries(plan.days)) {
        if (removedOutfitIds.has(outfitId)) {
          delete plan.days[day];
          changed = true;
        }
      }
      if (changed) {
        await env.DB.prepare("INSERT INTO settings (key, data) VALUES ('plan', ?1) ON CONFLICT(key) DO UPDATE SET data = excluded.data").bind(JSON.stringify(plan)).run();
      }
    }
  }
}

// ---------- garment cutout (Queue consumer) ----------

export async function makeGarment(env, jobId, keepBackground = false) {
  const current = await loadJob(env, jobId);
  const stage = current?.stages?.garment;
  if (!current || !stage) return { retry: false };
  const updatedMs = Date.parse(stage.updatedAt || "");
  const staleLease = stage.status === "processing" && (!Number.isFinite(updatedMs) || (Date.now() - updatedMs) > PROCESSING_LEASE_MS);
  if (stage.status !== "queued" && !staleLease) return { retry: false };

  Object.assign(stage, { status: "processing", decision: null, error: null, attempts: stage.attempts + 1, updatedAt: new Date().toISOString() });
  await saveJob(env, current);
  const outputName = `garment-${stage.attempts}.png`;
  try {
    const crop = await getObjectBytes(env, `jobs/${current.id}/${current.internal.cropFile}`);
    const cut = keepBackground ? crop : await removeBackground(env, crop);
    await putPng(env, `jobs/${current.id}/${outputName}`, encodePng(frameTransparentGarment(decodePng(cut))));
    const fresh = await loadJob(env, current.id);
    if (!fresh) return { retry: false };
    Object.assign(fresh.stages.garment, { status: "review", assetUrl: `${ASSET_ROOT}/${fresh.id}/${outputName}`, keptBackground: keepBackground, updatedAt: new Date().toISOString() });
    await saveJob(env, fresh);
    return { retry: false };
  } catch (error) {
    const transient = !error.permanent && !(error instanceof HttpError && error.status < 500) && stage.attempts < MAX_QUEUE_ATTEMPTS;
    const fresh = await loadJob(env, current.id);
    if (fresh) {
      Object.assign(fresh.stages.garment, {
        status: transient ? "queued" : "failed",
        error: error.message,
        updatedAt: new Date().toISOString(),
      });
      await saveJob(env, fresh);
    }
    return { retry: transient };
  }
}

async function enqueue(env, jobId, keepBackground = false) {
  await env.JOBS.send({ jobId, stage: "garment", keepBackground });
}

// ---------- routes ----------

async function setupStatus(env) {
  const ai = publicAiSettings(await loadAiSettings(env), envReader(env));
  const selected = ai.providers.find((entry) => entry.id === ai.provider);
  return { ready: ai.ready, hasApiKey: ai.ready, provider: ai.provider, providerName: selected.name, storage: "cloudflare", cutouts: Boolean(env.IMAGES) };
}

async function serveObject(env, key, cacheControl, cors) {
  const object = await env.BUCKET.get(key);
  if (!object) return json(404, { error: "Not found" }, cors);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/png",
      "Cache-Control": cacheControl,
      ETag: object.httpEtag,
      ...SECURITY_HEADERS,
      ...cors,
    },
  });
}

// The token comes in the Authorization header; image links use a
// short-lived image key instead (see imageKeyMatches in shared/core.mjs).
async function authorized(request, url, env) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (tokensMatch(env.WARDROBE_TOKEN, bearer)) return true;
  return request.method === "GET" && imageKeyMatches(env.WARDROBE_TOKEN, url);
}

async function handleApi(request, env, cors) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...cors } });
  // Open liveness check for the connect screen. The Worker always needs a token.
  if (pathname === "/api/health" && method === "GET") {
    return json(200, { ok: true, app: "wardrobe", version: setting(env, "WARDROBE_VERSION", packageInfo.version), protected: true }, cors);
  }
  if (!env.WARDROBE_TOKEN) return json(503, { error: "Set the WARDROBE_TOKEN secret on this Worker first." }, cors);
  // Check the token first, so the right token always gets in.
  if (!(await authorized(request, url, env))) {
    const ip = clientKey(request);
    const retryAfter = checkAuthRateLimit(ip);
    if (retryAfter) {
      return json(429, { error: "Too many failed authentication attempts. Try again shortly." }, cors, { "Retry-After": String(retryAfter) });
    }
    recordAuthFailure(ip);
    return json(401, { error: "Wardrobe access token required" }, cors);
  }
  if (pathname === "/api/import/image-key" && method === "GET") return json(200, await newImageKey(env.WARDROBE_TOKEN), cors);

  if (pathname === "/api/import/wardrobe" && method === "GET") return json(200, await listItems(env), cors);
  if (pathname === "/api/import/config" && method === "GET") return json(200, await setupStatus(env), cors);
  if (pathname === "/api/import/outfits" && method === "GET") return json(200, await listOutfits(env), cors);
  if (pathname === "/api/import/settings/ai" && method === "GET") return json(200, publicAiSettings(await loadAiSettings(env), envReader(env)), cors);
  if (pathname === "/api/import/settings/ai" && method === "PUT") {
    requireJsonContentType(request);
    const next = applyAiSettingsEdit(await loadAiSettings(env), await readJson(request, 16 * 1024));
    await saveAiSettings(env, next);
    return json(200, publicAiSettings(next, envReader(env)), cors);
  }

  if (pathname === "/api/import/plan" && method === "GET") {
    const row = await env.DB.prepare("SELECT data FROM settings WHERE key = 'plan'").first().catch(() => null);
    return json(200, normalizePlan(row ? JSON.parse(row.data) : {}), cors);
  }
  if (pathname === "/api/import/plan" && method === "PUT") {
    requireJsonContentType(request);
    const plan = normalizePlan(await readJson(request, 256 * 1024));
    await env.DB.prepare("INSERT INTO settings (key, data) VALUES ('plan', ?1) ON CONFLICT(key) DO UPDATE SET data = excluded.data").bind(JSON.stringify(plan)).run();
    return json(200, plan, cors);
  }
  if (pathname === "/api/import/wardrobe/sort" && method === "POST") {
    requireJsonContentType(request);
    const input = await readJson(request, 16 * 1024);
    const ai = await currentAi(env);
    const all = await listItems(env);
    const todo = input.all ? all : all.filter((item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality);
    if (!todo.length) return json(200, { items: [] }, cors);
    const sorted = await sortCloset(ai, todo);
    // Re-read current rows before batching updates so concurrent edits are preserved.
    const freshById = new Map((await listItems(env)).map((item) => [item.id, item]));
    const statements = [];
    const updated = [];
    for (const { id, ...fields } of sorted) {
      const record = freshById.get(id);
      if (!record) continue;
      const next = { ...record, ...fields };
      statements.push(env.DB.prepare("UPDATE items SET data = ? WHERE id = ?").bind(JSON.stringify(next), id));
      updated.push(next);
    }
    if (statements.length) await env.DB.batch(statements);
    return json(200, { items: updated }, cors);
  }

  // Same rules as the local server: see normalizeManualOutfit and applyOutfitEdit in shared/core.mjs.
  if (pathname === "/api/import/outfits" && method === "POST") {
    requireJsonContentType(request);
    const created = normalizeManualOutfit(await readJson(request, 64 * 1024), await listItems(env));
    await saveOutfit(env, created);
    return json(201, { outfit: created }, cors);
  }

  if (pathname === "/api/import/outfits/generate" && method === "POST") {
    requireJsonContentType(request);
    const input = await readJson(request, 64 * 1024);
    const count = Math.max(1, Math.min(MAX_STYLE_COUNT, Math.round(Number(input.count) || 4)));
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "";
    const items = await listItems(env);
    if (!canMakeOutfit(items)) {
      throw new HttpError(409, "Add a one-piece, or at least one top and one bottom, before styling outfits.");
    }
    const created = await styleOutfits(await currentAi(env), { items, outfits: await listOutfits(env), count, notes, ...styleOptions(input) });
    for (const outfit of created) await saveOutfit(env, outfit);
    return json(201, { outfits: created }, cors);
  }

  // Used by scripts/upload-to-cloudflare.mjs to copy a local closet up.
  if (pathname === "/api/import/sync/item" && method === "POST") {
    requireJsonContentType(request);
    const input = await readJson(request);
    const record = input.record;
    if (!record || typeof record.id !== "string" || !/^import-[\w-]{1,80}$/.test(record.id)) throw new HttpError(400, "record.id must look like import-...");
    const garment = decodeDataUrl({ imageBase64: input.garmentBase64 });
    await putPng(env, `library/${record.id}-garment.png`, garment.bytes);
    let modeledImage = null;
    if (input.modeledBase64) {
      await putPng(env, `library/${record.id}-modeled.png`, decodeDataUrl({ imageBase64: input.modeledBase64 }).bytes);
      modeledImage = `${LIBRARY_ASSET_ROOT}/${record.id}-modeled.png`;
    }
    const clean = normalizeItemEdit({
      ...record,
      image: `${LIBRARY_ASSET_ROOT}/${record.id}-garment.png`,
      thumbnail: `${LIBRARY_ASSET_ROOT}/${record.id}-garment.png`,
      modeledImage,
    }, { name: record.name || "New piece", part: record.part, color: record.color || "#d8d0c2", secondaryColor: record.secondaryColor || null, tags: record.tags || [] });
    await upsertItem(env, clean);
    return json(200, clean, cors);
  }
  if (pathname === "/api/import/sync/outfit" && method === "POST") {
    requireJsonContentType(request);
    const input = await readJson(request);
    const outfit = input.outfit;
    if (!outfit || typeof outfit.id !== "string" || !/^[\w-]{1,80}$/.test(outfit.id)) throw new HttpError(400, "outfit.id is required");
    let image = null;
    if (input.imageBase64) {
      await putPng(env, `outfits/${outfit.id}.png`, decodeDataUrl({ imageBase64: input.imageBase64 }).bytes);
      image = `outfit-images/${outfit.id}.png`;
    }
    const stored = { ...outfit, image };
    await saveOutfit(env, stored);
    return json(200, stored, cors);
  }

  const outfitMatch = pathname.match(/^\/api\/import\/outfits\/([\w-]{1,80})$/i);
  if (outfitMatch && method === "PATCH") {
    requireJsonContentType(request);
    const row = await env.DB.prepare("SELECT data FROM outfits WHERE id = ?").bind(outfitMatch[1]).first();
    if (!row) return json(404, { error: "Outfit not found" }, cors);
    const input = await readJson(request, 64 * 1024);
    const items = input.swap ? await listItems(env) : null;
    const next = applyOutfitEdit(JSON.parse(row.data), input, items);
    await saveOutfit(env, next);
    const fileName = typeof next.image === "string" ? next.image.split("/").pop() : null;
    return json(200, { ...next, image: fileName ? `${OUTFIT_ASSET_ROOT}/${fileName}` : null }, cors);
  }
  if (outfitMatch && method === "DELETE") {
    const id = outfitMatch[1];
    const { meta } = await env.DB.prepare("DELETE FROM outfits WHERE id = ?").bind(id).run();
    if (!meta.changes) return json(404, { error: "Outfit not found" }, cors);
    await env.BUCKET.delete(`outfits/${id}.png`);
    return json(200, { deleted: true, id }, cors);
  }

  const outfitAssetMatch = pathname.match(/^\/api\/import\/outfits\/([\w.-]+\.png)$/i);
  if (outfitAssetMatch && method === "GET") return serveObject(env, `outfits/${outfitAssetMatch[1]}`, "private, no-cache", cors);

  if (pathname === "/api/import/wardrobe" && method === "POST") {
    requireJsonContentType(request);
    const input = await readJson(request, 12 * 1024 * 1024);
    const bytes = checkPng(decodeDataUrl(input).bytes);
    const id = `import-${crypto.randomUUID()}`;
    const fileName = garmentFileName(id);
    await putPng(env, `library/${fileName}`, bytes);
    const record = newPieceRecord(input, id, `${LIBRARY_ASSET_ROOT}/${fileName}`);
    await upsertItem(env, record);
    return json(201, record, cors);
  }
  const imageMatch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})\/image$/i);
  if (imageMatch && method === "PUT") {
    requireJsonContentType(request);
    const id = imageMatch[1];
    const row = await env.DB.prepare("SELECT data FROM items WHERE id = ?").bind(id).first();
    if (!row) return json(404, { error: "Imported wardrobe item not found" }, cors);
    const bytes = checkPng(decodeDataUrl(await readJson(request, 12 * 1024 * 1024)).bytes);
    const fileName = garmentFileName(id);
    await putPng(env, `library/${fileName}`, bytes);
    const record = JSON.parse(row.data);
    const oldName = typeof record.image === "string" ? record.image.split("/").pop() : "";
    const next = { ...record, image: `${LIBRARY_ASSET_ROOT}/${fileName}`, thumbnail: `${LIBRARY_ASSET_ROOT}/${fileName}` };
    await env.DB.prepare("UPDATE items SET data = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
    if (oldName.startsWith(`${id}-garment`) && oldName !== fileName) await env.BUCKET.delete(`library/${oldName}`);
    return json(200, next, cors);
  }
  const itemMatch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})$/i);
  if (itemMatch && method === "DELETE") {
    const id = itemMatch[1];
    const row = await env.DB.prepare("SELECT data FROM items WHERE id = ?").bind(id).first();
    const { meta } = await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
    if (!meta.changes) return json(404, { error: "Imported wardrobe item not found" }, cors);
    const ownImage = row ? String(JSON.parse(row.data).image || "").split("/").pop() : "";
    await env.BUCKET.delete([`library/${id}-garment.png`, `library/${id}-modeled.png`, ...(ownImage.startsWith(`${id}-garment`) ? [`library/${ownImage}`] : [])]);
    await pruneDeletedGarment(env, id);
    return json(200, { deleted: true, id }, cors);
  }
  if (itemMatch && (method === "PATCH" || method === "PUT")) {
    requireJsonContentType(request);
    const id = itemMatch[1];
    const input = await readJson(request, 64 * 1024);
    const row = await env.DB.prepare("SELECT data FROM items WHERE id = ?").bind(id).first();
    if (!row) return json(404, { error: "Imported wardrobe item not found" }, cors);
    const record = normalizeItemEdit(JSON.parse(row.data), input);
    await env.DB.prepare("UPDATE items SET data = ? WHERE id = ?").bind(JSON.stringify(record), id).run();
    return json(200, record, cors);
  }

  const libraryAssetMatch = pathname.match(/^\/api\/import\/library\/([\w.-]+)$/i);
  if (libraryAssetMatch && method === "GET") return serveObject(env, `library/${libraryAssetMatch[1]}`, "private, max-age=31536000, immutable", cors);

  const assetMatch = pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
  if (assetMatch && method === "GET") return serveObject(env, `jobs/${assetMatch[1]}/${assetMatch[2]}`, "no-store", cors);

  if (pathname === API_ROOT && method === "POST") {
    requireJsonContentType(request);
    const ai = requireAi(await currentAi(env));
    const { bytes, mime } = decodeDataUrl(await readJson(request));
    let pngBytes = bytes;
    if ((mime === "image/jpeg" || isJpeg(bytes)) && env.IMAGES) {
      pngBytes = await transformImage(env, bytes, { width: 2048, height: 2048, fit: "scale-down" }, "image/png");
    }
    let image;
    try { image = decodePng(pngBytes); } catch { throw new HttpError(400, "Send the photo as a PNG or JPEG. Update the app if you see this."); }
    const normalizedBytes = encodePng(image);
    const detected = await detectClothing(ai, await imageForAi(env, image, bytes));
    const jobs = [];
    // Deduplicate original.png per multi-garment upload batch in R2.
    const originalFile = "original.png";
    const batchId = detected.length > 1 ? crypto.randomUUID() : null;
    if (batchId) await putPng(env, `jobs/${batchId}/${originalFile}`, normalizedBytes);
    for (const metadata of detected) {
      const id = crypto.randomUUID();
      const ownerId = batchId || id;
      const cropFile = "crop.png";
      if (!batchId) await putPng(env, `jobs/${id}/${originalFile}`, normalizedBytes);
      await putPng(env, `jobs/${id}/${cropFile}`, encodePng(cropDetectedItem(image, metadata.boundingBox)));
      const now = new Date().toISOString();
      const job = {
        id,
        status: "active",
        metadata,
        stages: { crop: { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now }, garment: stageState() },
        createdAt: now,
        updatedAt: now,
        internal: { originalFile, cropFile, ...(batchId ? { originalBatchId: batchId } : {}) },
        originalAssetUrl: `${ASSET_ROOT}/${ownerId}/${originalFile}`,
      };
      await saveJob(env, job);
      jobs.push(publicJob(job));
    }
    return json(202, { jobs, noClothingDetected: jobs.length === 0 }, cors);
  }

  if (pathname === API_ROOT && method === "GET") {
    const { results } = await env.DB.prepare("SELECT data FROM jobs ORDER BY created_at").all();
    const active = results
      .map((row) => JSON.parse(row.data))
      .filter((job) => job.status !== "complete" && !Object.values(job.stages || {}).some((stage) => stage.status === "rejected"));
    return json(200, active.map(publicJob), cors);
  }

  const match = pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
  if (!match) return json(404, { error: "Not found" }, cors);
  const job = await loadJob(env, match[1]);
  if (!job) return json(404, { error: "Job not found" }, cors);
  const action = match[2] || "";
  if (!action && method === "GET") return json(200, publicJob(job), cors);
  if (!action && method === "DELETE") {
    await deleteJob(env, job.id);
    return json(200, { deleted: true, id: job.id }, cors);
  }
  if (action === "metadata" && (method === "PATCH" || method === "PUT")) {
    requireJsonContentType(request);
    const input = await readJson(request, 64 * 1024);
    if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw new HttpError(400, "metadata must be an object");
    job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata });
    await saveJob(env, job);
    return json(200, publicJob(job), cors);
  }
  const stageMatch = action.match(/^stages\/(crop|garment)\/(approve|reject|retry|use-crop)$/);
  if (stageMatch && method === "POST") {
    const [, stageName, decision] = stageMatch;
    const stage = job.stages[stageName];
    if (decision === "retry" || decision === "use-crop") {
      if (stageName !== "garment" || job.stages.crop.status !== "approved" || stage.status === "processing") throw new HttpError(409, "The cutout cannot be redone right now");
      stage.status = "queued";
      await saveJob(env, job);
      await enqueue(env, job.id, decision === "use-crop");
      return json(202, publicJob(job), cors);
    }
    if (stage.status !== "review") throw new HttpError(409, "Stage is not ready for review");
    if (decision === "reject") {
      await deleteJob(env, job.id);
      return json(200, publicJob({ ...job, stages: { ...job.stages, [stageName]: { ...stage, status: "rejected", decision: "rejected" } } }), cors);
    }
    Object.assign(stage, { status: "approved", decision: "approved", error: null, updatedAt: new Date().toISOString() });
    if (stageName === "crop") {
      job.stages.garment.status = "queued";
      await saveJob(env, job);
      await enqueue(env, job.id);
      return json(200, publicJob(job), cors);
    }
    const record = await persistImported(env, job);
    job.status = "complete";
    await deleteJob(env, job.id);
    return json(200, { ...publicJob(job), item: record }, cors);
  }
  return json(404, { error: "Not found" }, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/health" && !url.pathname.startsWith("/api/import/")) return env.ASSETS.fetch(request);
    const cors = corsHeaders(request, env);
    try {
      return withCors(await handleApi(request, env, cors), request, env);
    } catch (error) {
      const status = error instanceof HttpError || error instanceof AiError || (error.status >= 400 && error.status < 500) ? error.status : 500;
      if (status === 500) console.error(error);
      return withCors(json(status, { error: status === 500 ? "Internal server error" : error.message }, cors, error.headers || {}), request, env);
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const { jobId, stage, keepBackground } = message.body || {};
      if (typeof jobId !== "string" || stage !== "garment") {
        message.ack();
        continue;
      }
      try {
        const result = await makeGarment(env, jobId, keepBackground === true);
        if (result?.retry) message.retry({ delaySeconds: 10 });
        else message.ack();
      } catch (error) {
        console.error(error);
        message.retry({ delaySeconds: 10 });
      }
    }
  },
};
