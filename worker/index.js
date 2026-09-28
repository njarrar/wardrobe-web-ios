// Cloudflare Worker version of the wardrobe API (see scripts/import-job-api.mjs
// for the local Node version). Images live in R2, records in D1, and the slow
// OpenAI image steps run from a Queue so requests return right away.
import {
  ANALYZE_PROMPT,
  ANALYZE_SCHEMA,
  MODELED_PROMPT,
  buildGarmentPrompt,
  chooseChromaKey,
  cleanupTolerance,
  normalizeItemEdit,
  normalizeMetadata,
  publicJob,
  stageState,
  tokensMatch,
} from "../shared/core.mjs";
import { cropDetectedItem, decodePng, encodePng, processChromaBackground } from "../shared/pixels.mjs";

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
const MODEL_REFERENCE_KEY = "model-reference";
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

const apiBaseUrl = (env) => setting(env, "OPENAI_API_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");

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

async function persistImported(env, job, includeModeled = false) {
  const id = `import-${job.id}`;
  const garmentName = `${id}-garment.png`;
  const garmentSource = job.stages.garment.assetUrl ? assetName(job.stages.garment.assetUrl) : `garment-${job.stages.garment.attempts}.png`;
  await putPng(env, `library/${garmentName}`, await getObjectBytes(env, `jobs/${job.id}/${garmentSource}`));
  let modeledImage = null;
  if (includeModeled) {
    const modeledName = `${id}-modeled.png`;
    const modeledSource = job.stages.modeled.assetUrl ? assetName(job.stages.modeled.assetUrl) : `modeled-${job.stages.modeled.attempts}.png`;
    await putPng(env, `library/${modeledName}`, await getObjectBytes(env, `jobs/${job.id}/${modeledSource}`));
    modeledImage = `${LIBRARY_ASSET_ROOT}/${modeledName}`;
  }
  const existingRow = await env.DB.prepare("SELECT data FROM items WHERE id = ?").bind(id).first();
  const existing = existingRow ? JSON.parse(existingRow.data) : null;
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
    modeledImage: modeledImage || existing?.modeledImage || null,
    importJobId: job.id,
  };
  await upsertItem(env, record);
  return record;
}

// ---------- OpenAI ----------

async function openAIEdit(env, { model, prompt, images, size }) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", size);
  form.set("quality", setting(env, "OPENAI_IMAGE_QUALITY", "high"));
  form.set("output_format", "png");
  for (const image of images) form.append("image[]", new Blob([image.bytes], { type: image.mime }), image.name);
  const response = await fetch(`${apiBaseUrl(env)}/images/edits`, {
    method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI image request failed (${response.status})`);
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI response did not contain image data");
  return decodeDataUrl({ imageBase64: encoded }).bytes;
}

async function openAIAnalyze(env, bytes) {
  const response = await fetch(`${apiBaseUrl(env)}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: setting(env, "OPENAI_VISION_MODEL", "gpt-5.4-mini"),
      input: [{ role: "user", content: [
        { type: "input_text", text: ANALYZE_PROMPT },
        { type: "input_image", image_url: `data:image/png;base64,${toBase64(bytes)}` },
      ] }],
      text: { format: { type: "json_schema", name: "wardrobe_items", strict: true, schema: ANALYZE_SCHEMA } },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI analysis failed (${response.status})`);
  const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI analysis returned no structured result");
  const parsed = JSON.parse(outputText);
  if (!Array.isArray(parsed.items)) throw new Error("OpenAI analysis returned an invalid clothing list");
  return parsed.items;
}

// ---------- background generation (Queue consumer) ----------

export async function generate(env, jobId, stageName) {
  const current = await loadJob(env, jobId);
  if (!current || !["queued", "pending"].includes(current.stages[stageName]?.status)) return;
  const stage = current.stages[stageName];
  stage.status = "processing"; stage.decision = null; stage.error = null; stage.attempts += 1; stage.updatedAt = new Date().toISOString();
  await saveJob(env, current);
  let failedAssetUrl = null;
  let chromaKeyUsed = null;
  try {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    const outputName = `${stageName}-${stage.attempts}.png`;
    let bytes;
    if (stageName === "garment") {
      const sourceFile = current.internal.cropFile || current.internal.originalFile;
      const source = { bytes: await getObjectBytes(env, `jobs/${current.id}/${sourceFile}`), mime: "image/png", name: sourceFile };
      chromaKeyUsed = chooseChromaKey(current.metadata.color);
      const basePrompt = buildGarmentPrompt(current.metadata, chromaKeyUsed);
      bytes = await openAIEdit(env, {
        model: setting(env, "OPENAI_GARMENT_MODEL", setting(env, "OPENAI_IMAGE_MODEL", "gpt-image-2")),
        size: "1024x1024",
        images: [source],
        prompt: stage.prompt ? `${basePrompt}\nUser regeneration direction: ${stage.prompt}` : basePrompt,
      });
      const rawName = `${stageName}-${stage.attempts}-source.png`;
      await putPng(env, `jobs/${current.id}/${rawName}`, bytes);
      failedAssetUrl = `${ASSET_ROOT}/${current.id}/${rawName}`;
      const cleaned = processChromaBackground(decodePng(bytes), chromaKeyUsed);
      if (cleaned.verification.contaminatedPixels > 1) {
        throw new Error(`Background cleanup left ${cleaned.verification.contaminatedPixels} chroma-contaminated pixels`);
      }
      bytes = encodePng(cleaned.image);
    } else {
      const garmentName = current.stages.garment.assetUrl ? assetName(current.stages.garment.assetUrl) : `garment-${current.stages.garment.attempts}.png`;
      const garment = { bytes: await getObjectBytes(env, `jobs/${current.id}/${garmentName}`), mime: "image/png", name: "garment.png" };
      const reference = await env.BUCKET.get(MODEL_REFERENCE_KEY);
      if (!reference) throw new Error("Upload a photo of yourself before creating modeled images.");
      const referenceMime = reference.httpMetadata?.contentType || "image/png";
      const model = { bytes: new Uint8Array(await reference.arrayBuffer()), mime: referenceMime, name: `model.${referenceMime.split("/")[1] || "png"}` };
      bytes = await openAIEdit(env, {
        model: setting(env, "OPENAI_MODELED_MODEL", setting(env, "OPENAI_IMAGE_MODEL", "gpt-image-2")),
        size: "1536x1024",
        images: [model, garment],
        prompt: stage.prompt ? `${MODELED_PROMPT}\nUser regeneration direction: ${stage.prompt}` : MODELED_PROMPT,
      });
    }
    await putPng(env, `jobs/${current.id}/${outputName}`, bytes);
    const fresh = await loadJob(env, current.id);
    if (!fresh) return;
    Object.assign(fresh.stages[stageName], {
      status: "review",
      assetUrl: `${ASSET_ROOT}/${fresh.id}/${outputName}`,
      failedAssetUrl: null,
      cleanupPreviewUrl: null,
      cleanupDiagnostics: null,
      updatedAt: new Date().toISOString(),
      ...(chromaKeyUsed ? { chromaKey: chromaKeyUsed } : {}),
    });
    await saveJob(env, fresh);
  } catch (error) {
    const fresh = await loadJob(env, current.id);
    if (!fresh) return;
    Object.assign(fresh.stages[stageName], {
      status: "failed",
      error: error.message,
      updatedAt: new Date().toISOString(),
      ...(failedAssetUrl ? { failedAssetUrl } : {}),
      ...(chromaKeyUsed ? { chromaKey: chromaKeyUsed } : {}),
    });
    await saveJob(env, fresh);
  }
}

async function enqueue(env, jobId, stage) {
  await env.JOBS.send({ jobId, stage });
}

// ---------- routes ----------

async function setupStatus(env) {
  const hasApiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasModelReference = Boolean(await env.BUCKET.head(MODEL_REFERENCE_KEY));
  return { ready: hasApiKey && hasModelReference, hasApiKey, hasModelReference, canUploadModelReference: true, storage: "cloudflare" };
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

  if (pathname === "/api/import/model-reference" && method === "PUT") {
    const { bytes, mime } = decodeDataUrl(await readJson(request));
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new HttpError(400, "Use a PNG, JPEG or WebP photo");
    await env.BUCKET.put(MODEL_REFERENCE_KEY, bytes, { httpMetadata: { contentType: mime } });
    return json(200, await setupStatus(env));
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
    await env.DB.prepare(`INSERT INTO outfits (id, data, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM outfits))
      ON CONFLICT(id) DO UPDATE SET data = excluded.data`).bind(outfit.id, JSON.stringify(stored)).run();
    return json(200, stored);
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
    const setup = await setupStatus(env);
    if (!setup.ready) {
      const missing = [
        !setup.hasApiKey && "the OPENAI_API_KEY secret on the Worker",
        !setup.hasModelReference && "a photo of yourself",
      ].filter(Boolean).join(" and ");
      return json(503, { error: `Setup required: add ${missing}.` });
    }
    const { bytes } = decodeDataUrl(await readJson(request));
    let image;
    try { image = decodePng(bytes); } catch { throw new HttpError(400, "Send the photo as a PNG. Update the app if you see this."); }
    const normalizedBytes = encodePng(image);
    const detected = (await openAIAnalyze(env, normalizedBytes)).map(normalizeMetadata);
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
        stages: { crop: { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now }, garment: stageState(), modeled: stageState() },
        createdAt: now,
        updatedAt: now,
        internal: { originalFile, cropFile, originalMime: "image/png" },
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
    const hidden = loaded.filter((job) => job.status === "complete" || job.stages.crop?.status === "rejected" || job.stages.garment.status === "rejected" || job.stages.modeled.status === "rejected");
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
  const cleanupAction = action.match(/^stages\/garment\/(cleanup-preview|cleanup-accept)$/);
  if (cleanupAction && method === "POST") {
    const stage = job.stages.garment;
    if (stage.status !== "failed" || !stage.failedAssetUrl) throw new HttpError(409, "No failed garment source is available for cleanup");
    const input = await readJson(request, 64 * 1024);
    const source = await getObjectBytes(env, `jobs/${job.id}/${assetName(stage.failedAssetUrl)}`);
    const key = stage.chromaKey || chooseChromaKey(job.metadata?.color);
    const cleaned = processChromaBackground(decodePng(source), key, { tolerance: cleanupTolerance(input.tolerance) });
    const previewName = `garment-${stage.attempts}-cleanup-${cleaned.tolerance}.png`;
    const previewUrl = `${ASSET_ROOT}/${job.id}/${previewName}`;
    await putPng(env, `jobs/${job.id}/${previewName}`, encodePng(cleaned.image));
    Object.assign(stage, { chromaKey: key, cleanupTolerance: cleaned.tolerance, cleanupDiagnostics: cleaned.verification, cleanupPreviewUrl: previewUrl, updatedAt: new Date().toISOString() });
    if (cleanupAction[1] === "cleanup-accept") Object.assign(stage, { status: "review", decision: null, error: null, assetUrl: previewUrl });
    await saveJob(env, job);
    return json(200, publicJob(job));
  }
  const stageMatch = action.match(/^stages\/(crop|garment|modeled)\/(approve|reject|regenerate)$/);
  if (stageMatch && method === "POST") {
    const [, stageName, decision] = stageMatch;
    if (decision === "regenerate") {
      if (stageName === "crop") throw new HttpError(400, "Upload the image again to create new crops");
      const input = await readJson(request, 64 * 1024);
      job.stages[stageName].prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1200) || null : null;
      job.stages[stageName].status = "queued";
      job.stages[stageName].decision = null;
      await saveJob(env, job);
      await enqueue(env, job.id, stageName);
      return json(202, publicJob(job));
    }
    if (job.stages[stageName].status !== "review") throw new HttpError(409, "Stage is not ready for review");
    const previous = { status: job.stages[stageName].status, decision: job.stages[stageName].decision, jobStatus: job.status };
    job.stages[stageName].decision = decision === "approve" ? "approved" : "rejected";
    job.stages[stageName].status = job.stages[stageName].decision;
    job.stages[stageName].error = null;
    job.stages[stageName].updatedAt = new Date().toISOString();
    const startGarment = stageName === "crop" && decision === "approve" && job.stages.garment.status === "pending";
    const startModeled = stageName === "garment" && decision === "approve" && job.stages.modeled.status === "pending";
    if (startGarment) job.stages.garment.status = "queued";
    if (startModeled) job.stages.modeled.status = "queued";
    if (stageName === "modeled" && decision === "approve") job.status = "complete";
    await saveJob(env, job);
    if (decision === "approve" && stageName !== "crop") {
      try {
        await persistImported(env, job, stageName === "modeled");
      } catch (error) {
        Object.assign(job.stages[stageName], { status: previous.status, decision: previous.decision });
        job.status = previous.jobStatus;
        if (startModeled) job.stages.modeled.status = "pending";
        await saveJob(env, job);
        throw error;
      }
    }
    const response = publicJob(job);
    if (decision === "reject" || job.status === "complete") await deleteJob(env, job.id);
    if (startGarment) await enqueue(env, job.id, "garment");
    if (startModeled) await enqueue(env, job.id, "modeled");
    return json(200, response);
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
      const { jobId, stage } = message.body || {};
      if (typeof jobId !== "string" || !["garment", "modeled"].includes(stage)) {
        message.ack();
        continue;
      }
      await generate(env, jobId, stage);
      message.ack();
    }
  },
};
