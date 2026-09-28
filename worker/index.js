// Cloudflare Worker version of the wardrobe API (see scripts/import-job-api.mjs
// for the local Node version). Images live in R2, records in D1, Claude finds
// and styles the clothes, and Cloudflare Images cuts each garment out of its
// background from a Queue so requests return right away.
import {
  MAX_STYLE_COUNT,
  normalizeItemEdit,
  normalizeMetadata,
  publicJob,
  stageState,
  tokensMatch,
} from "../shared/core.mjs";
import { CLAUDE_IMAGE_EDGE, createClaude, detectClothing, styleOutfits } from "../shared/claude.mjs";
import { cropDetectedItem, decodePng, encodePng, frameTransparentGarment, resize } from "../shared/pixels.mjs";

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
const MAX_BODY = 25 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

async function readJson(request, limit = MAX_BODY) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new HttpError(413, "Request body too large");
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "Request body too large");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Expected a JSON request body"); }
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

function setting(env, name, fallback = "") {
  return (typeof env[name] === "string" && env[name]) || fallback;
}

function claudeFor(env) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "Setup required: add the ANTHROPIC_API_KEY secret to the Worker.");
  return createClaude({ apiKey: env.ANTHROPIC_API_KEY, baseURL: setting(env, "ANTHROPIC_BASE_URL") || undefined });
}

const claudeModel = (env) => setting(env, "WARDROBE_CLAUDE_MODEL");

// ---------- images ----------

async function transformImage(env, bytes, transform, format) {
  const result = await env.IMAGES.input(new Blob([bytes]).stream()).transform(transform).output({ format });
  return new Uint8Array(await result.response().arrayBuffer());
}

// Claude reads images up to 1568px on the long edge. Cloudflare Images makes
// a JPEG that size; without the binding (tests), fall back to a small PNG.
async function imageForClaude(env, image, pngBytes) {
  if (env.IMAGES) {
    const jpeg = await transformImage(env, pngBytes, { width: CLAUDE_IMAGE_EDGE, height: CLAUDE_IMAGE_EDGE, fit: "scale-down" }, "image/jpeg");
    return { imageBase64: toBase64(jpeg), mediaType: "image/jpeg" };
  }
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const small = scale < 1 ? resize(image, Math.round(image.width * scale), Math.round(image.height * scale)) : image;
  return { imageBase64: toBase64(encodePng(small)), mediaType: "image/png" };
}

async function removeBackground(env, cropBytes) {
  if (!env.IMAGES) throw new Error("Background removal needs the Cloudflare Images binding. Use the crop as is, or add the binding.");
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
  await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
  let cursor;
  do {
    const listing = await env.BUCKET.list({ prefix: `jobs/${id}/`, cursor });
    if (listing.objects.length) await env.BUCKET.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
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
    image: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
    thumbnail: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
    importJobId: job.id,
  };
  await upsertItem(env, record);
  return record;
}

async function saveOutfit(env, outfit) {
  await env.DB.prepare(`INSERT INTO outfits (id, data, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM outfits))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(outfit.id, JSON.stringify(outfit)).run();
}

// ---------- garment cutout (Queue consumer) ----------

export async function makeGarment(env, jobId, keepBackground = false) {
  const current = await loadJob(env, jobId);
  if (!current || current.stages.garment?.status !== "queued") return;
  const stage = current.stages.garment;
  Object.assign(stage, { status: "processing", decision: null, error: null, attempts: stage.attempts + 1, updatedAt: new Date().toISOString() });
  await saveJob(env, current);
  const outputName = `garment-${stage.attempts}.png`;
  try {
    const crop = await getObjectBytes(env, `jobs/${current.id}/${current.internal.cropFile}`);
    const cut = keepBackground ? crop : await removeBackground(env, crop);
    await putPng(env, `jobs/${current.id}/${outputName}`, encodePng(frameTransparentGarment(decodePng(cut))));
    const fresh = await loadJob(env, current.id);
    if (!fresh) return;
    Object.assign(fresh.stages.garment, { status: "review", assetUrl: `${ASSET_ROOT}/${fresh.id}/${outputName}`, keptBackground: keepBackground, updatedAt: new Date().toISOString() });
    await saveJob(env, fresh);
  } catch (error) {
    const fresh = await loadJob(env, current.id);
    if (!fresh) return;
    Object.assign(fresh.stages.garment, { status: "failed", error: error.message, updatedAt: new Date().toISOString() });
    await saveJob(env, fresh);
  }
}

async function enqueue(env, jobId, keepBackground = false) {
  await env.JOBS.send({ jobId, stage: "garment", keepBackground });
}

// ---------- routes ----------

async function setupStatus(env) {
  const hasApiKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  return { ready: hasApiKey, hasApiKey, storage: "cloudflare", cutouts: Boolean(env.IMAGES) };
}

async function serveObject(env, key, cacheControl) {
  const object = await env.BUCKET.get(key);
  if (!object) return json(404, { error: "Not found" });
  return new Response(object.body, {
    headers: { "Content-Type": object.httpMetadata?.contentType || "image/png", "Cache-Control": cacheControl, ETag: object.httpEtag, ...CORS_HEADERS },
  });
}

function authorized(request, url, env) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  return tokensMatch(env.WARDROBE_TOKEN, bearer) || tokensMatch(env.WARDROBE_TOKEN, url.searchParams.get("token"));
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!env.WARDROBE_TOKEN) return json(503, { error: "Set the WARDROBE_TOKEN secret on this Worker first." });
  if (!authorized(request, url, env)) return json(401, { error: "Wardrobe access token required" });

  if (pathname === "/api/import/wardrobe" && method === "GET") return json(200, await listItems(env));
  if (pathname === "/api/import/config" && method === "GET") return json(200, await setupStatus(env));
  if (pathname === "/api/import/outfits" && method === "GET") return json(200, await listOutfits(env));

  if (pathname === "/api/import/outfits/generate" && method === "POST") {
    const input = await readJson(request, 64 * 1024);
    const count = Math.max(1, Math.min(MAX_STYLE_COUNT, Math.round(Number(input.count) || 4)));
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "";
    const items = await listItems(env);
    if (!items.some((item) => item.part === "upperbody") || !items.some((item) => item.part === "lowerbody")) {
      throw new HttpError(409, "Add at least one top and one bottom before styling outfits.");
    }
    const client = claudeFor(env);
    const created = await styleOutfits(client, { model: claudeModel(env), items, outfits: await listOutfits(env), count, notes });
    for (const outfit of created) await saveOutfit(env, outfit);
    return json(201, { outfits: created });
  }

  // Used by scripts/upload-to-cloudflare.mjs to copy a local closet up.
  if (pathname === "/api/import/sync/item" && method === "POST") {
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
    return json(200, clean);
  }
  if (pathname === "/api/import/sync/outfit" && method === "POST") {
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
    return json(200, stored);
  }

  const outfitMatch = pathname.match(/^\/api\/import\/outfits\/([\w-]{1,80})$/i);
  if (outfitMatch && method === "DELETE") {
    const id = outfitMatch[1];
    const { meta } = await env.DB.prepare("DELETE FROM outfits WHERE id = ?").bind(id).run();
    if (!meta.changes) return json(404, { error: "Outfit not found" });
    await env.BUCKET.delete(`outfits/${id}.png`);
    return json(200, { deleted: true, id });
  }

  const outfitAssetMatch = pathname.match(/^\/api\/import\/outfits\/([\w.-]+\.png)$/i);
  if (outfitAssetMatch && method === "GET") return serveObject(env, `outfits/${outfitAssetMatch[1]}`, "no-cache");

  const itemMatch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})$/i);
  if (itemMatch && method === "DELETE") {
    const id = itemMatch[1];
    const { meta } = await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
    if (!meta.changes) return json(404, { error: "Imported wardrobe item not found" });
    await env.BUCKET.delete([`library/${id}-garment.png`, `library/${id}-modeled.png`]);
    return json(200, { deleted: true, id });
  }
  if (itemMatch && (method === "PATCH" || method === "PUT")) {
    const id = itemMatch[1];
    const input = await readJson(request, 64 * 1024);
    const row = await env.DB.prepare("SELECT data FROM items WHERE id = ?").bind(id).first();
    if (!row) return json(404, { error: "Imported wardrobe item not found" });
    const record = normalizeItemEdit(JSON.parse(row.data), input);
    await env.DB.prepare("UPDATE items SET data = ? WHERE id = ?").bind(JSON.stringify(record), id).run();
    return json(200, record);
  }

  const libraryAssetMatch = pathname.match(/^\/api\/import\/library\/([\w.-]+)$/i);
  if (libraryAssetMatch && method === "GET") return serveObject(env, `library/${libraryAssetMatch[1]}`, "private, max-age=31536000, immutable");

  const assetMatch = pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
  if (assetMatch && method === "GET") return serveObject(env, `jobs/${assetMatch[1]}/${assetMatch[2]}`, "no-store");

  if (pathname === API_ROOT && method === "POST") {
    const client = claudeFor(env);
    const { bytes } = decodeDataUrl(await readJson(request));
    let image;
    try { image = decodePng(bytes); } catch { throw new HttpError(400, "Send the photo as a PNG. Update the app if you see this."); }
    const normalizedBytes = encodePng(image);
    const detected = await detectClothing(client, { model: claudeModel(env), ...(await imageForClaude(env, image, normalizedBytes)) });
    const jobs = [];
    for (const metadata of detected) {
      const id = crypto.randomUUID();
      const originalFile = "original.png";
      const cropFile = "crop.png";
      await putPng(env, `jobs/${id}/${originalFile}`, normalizedBytes);
      await putPng(env, `jobs/${id}/${cropFile}`, encodePng(cropDetectedItem(image, metadata.boundingBox)));
      const now = new Date().toISOString();
      const job = {
        id,
        status: "active",
        metadata,
        stages: { crop: { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now }, garment: stageState() },
        createdAt: now,
        updatedAt: now,
        internal: { originalFile, cropFile },
        originalAssetUrl: `${ASSET_ROOT}/${id}/${originalFile}`,
      };
      await saveJob(env, job);
      jobs.push(publicJob(job));
    }
    return json(202, { jobs, noClothingDetected: jobs.length === 0 });
  }

  if (pathname === API_ROOT && method === "GET") {
    const { results } = await env.DB.prepare("SELECT data FROM jobs ORDER BY created_at").all();
    const loaded = results.map((row) => JSON.parse(row.data));
    const hidden = loaded.filter((job) => job.status === "complete" || Object.values(job.stages).some((stage) => stage.status === "rejected"));
    await Promise.all(hidden.map((job) => deleteJob(env, job.id)));
    return json(200, loaded.filter((job) => !hidden.includes(job)).map(publicJob));
  }

  const match = pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
  if (!match) return json(404, { error: "Not found" });
  const job = await loadJob(env, match[1]);
  if (!job) return json(404, { error: "Job not found" });
  const action = match[2] || "";
  if (!action && method === "GET") return json(200, publicJob(job));
  if (!action && method === "DELETE") {
    await deleteJob(env, job.id);
    return json(200, { deleted: true, id: job.id });
  }
  if (action === "metadata" && (method === "PATCH" || method === "PUT")) {
    const input = await readJson(request, 64 * 1024);
    if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw new HttpError(400, "metadata must be an object");
    job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata });
    await saveJob(env, job);
    return json(200, publicJob(job));
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
      return json(202, publicJob(job));
    }
    if (stage.status !== "review") throw new HttpError(409, "Stage is not ready for review");
    if (decision === "reject") {
      await deleteJob(env, job.id);
      return json(200, publicJob({ ...job, stages: { ...job.stages, [stageName]: { ...stage, status: "rejected", decision: "rejected" } } }));
    }
    Object.assign(stage, { status: "approved", decision: "approved", error: null, updatedAt: new Date().toISOString() });
    if (stageName === "crop") {
      job.stages.garment.status = "queued";
      await saveJob(env, job);
      await enqueue(env, job.id);
      return json(200, publicJob(job));
    }
    const record = await persistImported(env, job);
    job.status = "complete";
    await deleteJob(env, job.id);
    return json(200, { ...publicJob(job), item: record });
  }
  return json(404, { error: "Not found" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/import/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      return json(status, { error: status === 500 ? "Internal server error" : error.message });
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const { jobId, stage, keepBackground } = message.body || {};
      if (typeof jobId !== "string" || stage !== "garment") {
        message.ack();
        continue;
      }
      await makeGarment(env, jobId, keepBackground === true);
      message.ack();
    }
  },
};
