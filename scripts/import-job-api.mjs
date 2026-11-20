import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  MAX_STYLE_COUNT,
  allowedOrigin,
  canMakeOutfit,
  styleOptions,
  checkPng,
  garmentFileName,
  newPieceRecord,
  sortFields,
  isLoopbackHost,
  normalizeBoundingBox,
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
import { AI_IMAGE_EDGE, applyAiSettingsEdit, detectClothing, publicAiSettings, requireAi, resolveAi, sortCloset, styleOutfits } from "../shared/ai.mjs";

export { isLoopbackHost };

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
export const DEFAULT_CUTOUT_MODEL = "onnx-community/BiRefNet_lite";

const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_FAILURES = 30;
const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function json(res, status, value) {
  res.statusCode = status;
  applySecurityHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function isLoopbackAddress(address = "") {
  const value = String(address).trim().toLowerCase();
  return value === "127.0.0.1"
    || value === "::1"
    || value === "::ffff:127.0.0.1"
    || value.startsWith("127.")
    || value.startsWith("::ffff:127.");
}

function isAllowedLoopbackOrigin(origin) {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.host);
  } catch {
    return false;
  }
}

// Guards mutating JSON endpoints against cross-site form/text CSRF.
// `strict: true` rejects every non-application/json request (e.g. AI settings).
// Otherwise, rejects form/multipart bodies, any browser-originated non-JSON
// request (Origin or Sec-Fetch-Site present), and explicit non-JSON types.
function requireJsonContentType(req, { strict = false } = {}) {
  const raw = String(req.headers["content-type"] || "").trim().toLowerCase();
  if (raw.startsWith("application/json")) return;
  if (strict) {
    throw Object.assign(new Error("Send settings as application/json"), { status: 415 });
  }
  if (!raw) return;
  if (raw.startsWith("application/x-www-form-urlencoded") || raw.startsWith("multipart/form-data")) {
    throw Object.assign(new Error("Send request body as application/json"), { status: 415 });
  }
  const hasBrowserHeaders = Boolean(req.headers.origin || req.headers["sec-fetch-site"]);
  if (hasBrowserHeaders || !raw.startsWith("text/plain;charset=utf-8")) {
    throw Object.assign(new Error("Send request body as application/json"), { status: 415 });
  }
}

async function body(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Expected a JSON request body"), { status: 400 }); }
}

function decodeImage(input) {
  const raw = input.imageDataUrl || input.imageBase64;
  if (!raw || typeof raw !== "string") throw Object.assign(new Error("imageDataUrl or imageBase64 is required"), { status: 400 });
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = match?.[1] || input.mimeType || "image/png";
  const data = Buffer.from(match?.[2] || raw, "base64");
  if (!data.length) throw Object.assign(new Error("Image payload is empty"), { status: 400 });
  return { data, mime };
}

async function normalizeImage(bytes) {
  return sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
}

export async function cropDetectedItem(bytes, boundingBox) {
  const normalized = await normalizeImage(bytes);
  const { width, height } = await sharp(normalized).metadata();
  const box = normalizeBoundingBox(boundingBox);
  const rawLeft = (box.x / 1000) * width;
  const rawTop = (box.y / 1000) * height;
  const rawWidth = (box.width / 1000) * width;
  const rawHeight = (box.height / 1000) * height;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  return sharp(normalized).extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).png().toBuffer();
}

export async function frameTransparentGarment(bytes, canvasSize = 1024, occupancy = 0.88) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    if (data[index + 3] <= 8) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) throw new Error("Background removal did not leave a visible garment");

  const trimmed = await sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
  const targetSize = Math.max(1, Math.round(canvasSize * Math.max(0.5, Math.min(0.96, occupancy))));
  const resized = await sharp(trimmed)
    .resize(targetSize, targetSize, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((canvasSize - resized.info.width) / 2);
  const top = Math.floor((canvasSize - resized.info.height) / 2);
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized.data, left, top }])
    .png()
    .toBuffer();
}

// The AI reads images up to 1568px on the long edge; send a JPEG that size.
async function imageForAi(bytes) {
  const data = await sharp(bytes).resize(AI_IMAGE_EDGE, AI_IMAGE_EDGE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  return data.toString("base64");
}

// Local background removal runs a small open model through transformers.js.
// It is an optional install, so the import falls back to the plain crop when
// it is missing (see the "use-crop" action). Pipelines are keyed by model and
// serialized behind a 1-slot semaphore so concurrent cutouts cannot OOM a 2 GB NAS.
const cutoutPipelines = new Map();
let cutoutLock = Promise.resolve();

function withCutoutSlot(task) {
  const run = cutoutLock.then(task);
  cutoutLock = run.catch(() => undefined);
  return run;
}

export async function removeBackground(bytes, model, { cacheDir } = {}) {
  const key = `${model || DEFAULT_CUTOUT_MODEL}::${cacheDir || ""}`;
  let pipelinePromise = cutoutPipelines.get(key);
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      let transformers;
      try { transformers = await import("@huggingface/transformers"); }
      catch { throw new Error("Background removal is not installed. Run npm install @huggingface/transformers, or use the crop as is."); }
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        transformers.env.cacheDir = cacheDir;
      }
      return transformers.pipeline("background-removal", model || DEFAULT_CUTOUT_MODEL, { dtype: "fp32" }).then((run) => ({ run, RawImage: transformers.RawImage }));
    })();
    cutoutPipelines.set(key, pipelinePromise);
    pipelinePromise.catch(() => { cutoutPipelines.delete(key); });
  }
  return withCutoutSlot(async () => {
    const { run, RawImage } = await pipelinePromise;
    const input = await RawImage.fromBlob(new Blob([bytes], { type: "image/png" }));
    const output = (await run(input)).rgba();
    return sharp(Buffer.from(output.data), { raw: { width: output.width, height: output.height, channels: 4 } }).png().toBuffer();
  });
}

async function atomicJson(file, value, mode) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  const delays = [40, 100, 200];
  try {
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        await rename(tmp, file);
        return;
      } catch (error) {
        if ((error.code === "EBUSY" || error.code === "EPERM") && attempt < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          continue;
        }
        if (!["EBUSY", "EXDEV", "EPERM"].includes(error.code)) throw error;
        await copyFile(tmp, file);
        return;
      }
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

async function serveImageFile(req, res, file, cacheControl) {
  const info = await stat(file);
  if (!info.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  applySecurityHeaders(res);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", cacheControl);
  if (req.headers["if-none-match"] === etag) {
    res.statusCode = 304;
    return res.end();
  }
  const ext = path.extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", IMAGE_MIME[ext] || "image/png");
  res.setHeader("Content-Length", info.size);
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

export function createWardrobeApi(options = {}) {
  let root;
  let jobsDir;
  let importedFile;
  let libraryAssetDir;
  let outfitsFile;
  let outfitAssetDir;
  let settingsFile;
  let planFile;
  let writeQueue = Promise.resolve();
  const running = new Map();
  const authFailures = new Map();
  const setting = (name, fallback = "") => options.env?.[name] || process.env[name] || fallback;
  const cutout = options.removeBackground || ((bytes) => removeBackground(bytes, setting("WARDROBE_CUTOUT_MODEL", DEFAULT_CUTOUT_MODEL), { cacheDir: setting("WARDROBE_MODEL_CACHE") || undefined }));

  function checkAuthRateLimit(ip, now = Date.now()) {
    const entry = authFailures.get(ip);
    if (!entry) return null;
    if (now >= entry.resetAt) {
      authFailures.delete(ip);
      return null;
    }
    return entry.count >= AUTH_MAX_FAILURES ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : null;
  }

  function recordAuthFailure(ip, now = Date.now()) {
    if (authFailures.size > 500) {
      for (const [key, entry] of authFailures) {
        if (now >= entry.resetAt) authFailures.delete(key);
      }
    }
    const entry = authFailures.get(ip);
    if (!entry || now >= entry.resetAt) {
      authFailures.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }

  // The AI picked in Settings and the keys pasted there live in
  // data/settings.json (readable by the server's user only). Keys in .env or
  // the container environment still work when nothing is saved.
  async function loadAiSettings() {
    try { return JSON.parse(await readFile(settingsFile, "utf8")).ai || {}; }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  }

  async function currentAi() {
    return resolveAi(await loadAiSettings(), setting);
  }

  async function setupStatus() {
    const ai = publicAiSettings(await loadAiSettings(), setting);
    const selected = ai.providers.find((entry) => entry.id === ai.provider);
    return { ready: ai.ready, hasApiKey: ai.ready, provider: ai.provider, providerName: selected.name, storage: "local" };
  }

  async function loadJob(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
    try { return JSON.parse(await readFile(path.join(jobsDir, id, "job.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async function saveJob(job) {
    job.updatedAt = new Date().toISOString();
    await atomicJson(path.join(jobsDir, job.id, "job.json"), job);
  }

  async function removeJobFiles(job) {
    await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
    const batchId = job?.internal?.originalBatchId;
    if (!batchId || batchId === job.id) return;
    const ids = await readdir(jobsDir).catch(() => []);
    for (const id of ids) {
      if (id === batchId) continue;
      const other = await loadJob(id);
      if (other?.internal?.originalBatchId === batchId) return;
    }
    await rm(path.join(jobsDir, batchId), { recursive: true, force: true });
  }

  async function loadImported() {
    try { return JSON.parse(await readFile(importedFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  // Every read-modify-write of library.json, outfits.json and plan.json runs
  // through this queue so two changes landing at once cannot drop each other.
  function serially(task) {
    const run = writeQueue.then(task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  function updateLibrary(change) {
    return serially(async () => {
      const records = await loadImported();
      const result = await change(records);
      if (result?.records) await atomicJson(importedFile, result.records);
      return result?.value;
    });
  }

  async function loadOutfitRecords() {
    try {
      const value = JSON.parse(await readFile(outfitsFile, "utf8"));
      return Array.isArray(value) ? value : Array.isArray(value?.outfits) ? value.outfits : [];
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  function updateOutfits(change) {
    return serially(async () => {
      const outfits = await loadOutfitRecords();
      const result = await change(outfits);
      if (result?.outfits) await atomicJson(outfitsFile, { version: 1, outfits: result.outfits });
      return result?.value;
    });
  }

  async function loadPlan() {
    try { return normalizePlan(JSON.parse(await readFile(planFile, "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return normalizePlan({}); throw error; }
  }

  // Removes a deleted garment ID from saved outfits, drops outfits left with
  // fewer than 2 pieces, and removes those dropped outfit IDs from plan.json.
  async function pruneDeletedGarment(garmentId) {
    const removedOutfits = await updateOutfits((outfits) => {
      let changed = false;
      const kept = [];
      const dropped = [];
      for (const outfit of outfits) {
        if (!Array.isArray(outfit.garmentIds) || !outfit.garmentIds.includes(garmentId)) {
          kept.push(outfit);
          continue;
        }
        changed = true;
        const nextIds = outfit.garmentIds.filter((id) => id !== garmentId);
        if (nextIds.length < 2) dropped.push(outfit);
        else kept.push({ ...outfit, garmentIds: nextIds });
      }
      return changed ? { outfits: kept, value: dropped } : { value: [] };
    });
    if (!removedOutfits?.length) return;
    await Promise.all(removedOutfits.map((outfit) => (
      typeof outfit.image === "string" ? rm(path.join(outfitAssetDir, path.basename(outfit.image)), { force: true }) : null
    )));
    const droppedIds = new Set(removedOutfits.map((outfit) => outfit.id));
    await serially(async () => {
      const plan = await loadPlan();
      let changed = false;
      for (const [day, outfitId] of Object.entries(plan.days)) {
        if (droppedIds.has(outfitId)) {
          delete plan.days[day];
          changed = true;
        }
      }
      if (changed) await atomicJson(planFile, plan);
    });
  }

  // Older outfits may carry a photo in data/outfit-images; new ones are a
  // collage of the garment cutouts drawn by the app.
  function outfitForClient(outfit) {
    const fileName = typeof outfit.image === "string" ? path.basename(outfit.image) : null;
    return { ...outfit, image: fileName ? `${OUTFIT_ASSET_ROOT}/${fileName}` : null };
  }

  // The token comes in the Authorization header; image links use a
  // short-lived image key instead (see imageKeyMatches in shared/core.mjs).
  // Without a token, only local loopback requests from same-origin / non-cross-site
  // callers are allowed so another web page cannot drive localhost via CSRF.
  async function authorize(req, url) {
    const token = setting("WARDROBE_TOKEN").trim();
    if (!token) {
      if (!isLoopbackHost(req.headers.host)) return false;
      const remote = req.socket?.remoteAddress;
      if (remote && !isLoopbackAddress(remote)) return false;
      const secFetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
      if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
      if (!isAllowedLoopbackOrigin(req.headers.origin)) return false;
      return true;
    }
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (tokensMatch(token, bearer)) return true;
    return req.method === "GET" && imageKeyMatches(token, url);
  }

  function applyCors(req, res) {
    // Cross-origin access is only opened up when a token guards the API, so
    // a random web page cannot drive the local server through the browser.
    if (!setting("WARDROBE_TOKEN").trim()) return;
    res.setHeader("Vary", "Origin");
    const origin = allowedOrigin(req.headers.origin, setting("WARDROBE_CORS_ORIGINS"));
    if (!origin) return;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  }

  async function persistImported(job) {
    const id = `import-${job.id}`;
    await mkdir(libraryAssetDir, { recursive: true });
    const garmentName = `${id}-garment.png`;
    await copyFile(path.join(jobsDir, job.id, path.basename(new URL(job.stages.garment.assetUrl, "http://localhost").pathname)), path.join(libraryAssetDir, garmentName));
    const metadata = job.metadata || {};
    return updateLibrary((records) => {
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
      return { records: [...records.filter((item) => item.id !== id), record], value: record };
    });
  }

  // Cuts the approved crop out of its background. With keepBackground the crop
  // is framed as is, which is the way out when background removal fails.
  function makeGarment(job, { keepBackground = false } = {}) {
    if (running.has(job.id)) return running.get(job.id);
    const task = (async () => {
      const current = await loadJob(job.id);
      if (!current) return;
      const stage = current.stages.garment;
      Object.assign(stage, { status: "processing", decision: null, error: null, attempts: stage.attempts + 1, updatedAt: new Date().toISOString() });
      await saveJob(current);
      const dir = path.join(jobsDir, current.id);
      const outputName = `garment-${stage.attempts}.png`;
      try {
        const crop = await readFile(path.join(dir, current.internal.cropFile));
        const cut = keepBackground ? crop : await cutout(crop);
        await writeFile(path.join(dir, outputName), await frameTransparentGarment(cut));
        const fresh = await loadJob(current.id);
        if (!fresh) return;
        Object.assign(fresh.stages.garment, { status: "review", assetUrl: `${ASSET_ROOT}/${fresh.id}/${outputName}`, keptBackground: keepBackground, updatedAt: new Date().toISOString() });
        await saveJob(fresh);
      } catch (error) {
        const fresh = await loadJob(current.id);
        if (!fresh) return;
        Object.assign(fresh.stages.garment, { status: "failed", error: error.message, updatedAt: new Date().toISOString() });
        await saveJob(fresh);
      }
    })().finally(() => running.delete(job.id));
    running.set(job.id, task);
    return task;
  }

  // Open liveness check for Docker and for the connect screen. It says whether
  // a token is needed, and nothing about the closet itself.
  function health(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    applySecurityHeaders(res);
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, { ok: true, app: "wardrobe", version: options.version || "dev", protected: Boolean(setting("WARDROBE_TOKEN").trim()) });
  }

  async function handler(req, res, next) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") return health(req, res);
    if (!url.pathname.startsWith("/api/import/")) return next();
    applyCors(req, res);
    applySecurityHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    // Check the token first, so the right token always gets in, even from an
    // address (a reverse proxy) that also sends bad tries.
    const ip = req.socket?.remoteAddress || "unknown";
    if (!(await authorize(req, url))) {
      const retryAfter = checkAuthRateLimit(ip);
      if (retryAfter) {
        res.setHeader("Retry-After", String(retryAfter));
        return json(res, 429, { error: "Too many failed authentication attempts. Try again shortly." });
      }
      if (setting("WARDROBE_TOKEN").trim()) recordAuthFailure(ip);
      return json(res, 401, { error: "Wardrobe access token required" });
    }
    try {
      if (url.pathname === "/api/import/image-key" && req.method === "GET") {
        const token = setting("WARDROBE_TOKEN").trim();
        res.setHeader("Cache-Control", "no-store");
        return json(res, 200, token ? await newImageKey(token) : { key: null });
      }
      if (url.pathname === "/api/import/wardrobe" && req.method === "GET") {
        return json(res, 200, await loadImported());
      }
      if (url.pathname === "/api/import/config" && req.method === "GET") {
        return json(res, 200, await setupStatus());
      }
      if (url.pathname === "/api/import/settings/ai" && req.method === "GET") {
        return json(res, 200, publicAiSettings(await loadAiSettings(), setting));
      }
      // Asking for JSON makes a browser check with the server first, so a web
      // page on another site cannot change the keys behind your back.
      if (url.pathname === "/api/import/settings/ai" && req.method === "PUT") {
        requireJsonContentType(req, { strict: true });
        const input = await body(req, 16 * 1024);
        const saved = await serially(async () => {
          const next = applyAiSettingsEdit(await loadAiSettings(), input);
          let file = {};
          try { file = JSON.parse(await readFile(settingsFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
          await atomicJson(settingsFile, { ...file, ai: next }, 0o600);
          return next;
        });
        return json(res, 200, publicAiSettings(saved, setting));
      }
      if (url.pathname === "/api/import/plan" && req.method === "GET") {
        return json(res, 200, await loadPlan());
      }
      if (url.pathname === "/api/import/plan" && req.method === "PUT") {
        requireJsonContentType(req);
        const plan = normalizePlan(await body(req, 256 * 1024));
        await serially(() => atomicJson(planFile, plan));
        return json(res, 200, plan);
      }
      // Fills in kind, seasons, warmth and dress level from names and tags (no photos).
      if (url.pathname === "/api/import/wardrobe/sort" && req.method === "POST") {
        requireJsonContentType(req);
        const input = await body(req, 16 * 1024);
        const ai = await currentAi();
        const all = await loadImported();
        const todo = input.all ? all : all.filter((item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality);
        if (!todo.length) return json(res, 200, { items: [] });
        const sorted = new Map((await sortCloset(ai, todo)).map((entry) => [entry.id, entry]));
        const items = await updateLibrary((records) => {
          const next = records.map((record) => {
            const fields = sorted.get(record.id);
            if (!fields) return record;
            const { id, ...rest } = fields;
            return { ...record, ...rest };
          });
          return { records: next, value: next.filter((record) => sorted.has(record.id)) };
        });
        return json(res, 200, { items });
      }
      if (url.pathname === "/api/import/outfits" && req.method === "GET") {
        return json(res, 200, (await loadOutfitRecords()).map(outfitForClient));
      }
      // An outfit built by hand in the app. The pieces must already be in the closet.
      if (url.pathname === "/api/import/outfits" && req.method === "POST") {
        requireJsonContentType(req);
        const created = normalizeManualOutfit(await body(req, 64 * 1024), await loadImported());
        await updateOutfits((outfits) => ({ outfits: [created, ...outfits] }));
        return json(res, 201, { outfit: outfitForClient(created) });
      }
      if (url.pathname === "/api/import/outfits/generate" && req.method === "POST") {
        requireJsonContentType(req);
        const input = await body(req, 64 * 1024);
        const count = Math.max(1, Math.min(MAX_STYLE_COUNT, Math.round(Number(input.count) || 4)));
        const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "";
        const items = await loadImported();
        if (!canMakeOutfit(items)) {
          throw Object.assign(new Error("Add a one-piece, or at least one top and one bottom, before styling outfits."), { status: 409 });
        }
        const ai = await currentAi();
        const existing = await loadOutfitRecords();
        const created = await styleOutfits(ai, { items, outfits: existing, count, notes, ...styleOptions(input) });
        await updateOutfits((outfits) => ({ outfits: [...outfits, ...created] }));
        return json(res, 201, { outfits: created.map(outfitForClient) });
      }
      const outfitMatch = url.pathname.match(/^\/api\/import\/outfits\/([\w-]{1,80})$/i);
      // Rename an outfit, change its occasions/note/favorite, or swap a piece.
      if (outfitMatch && req.method === "PATCH") {
        requireJsonContentType(req);
        const id = outfitMatch[1];
        const input = await body(req, 64 * 1024);
        const items = input.swap ? await loadImported() : null;
        const updated = await updateOutfits((outfits) => {
          const index = outfits.findIndex((outfit) => outfit.id === id);
          if (index === -1) return { value: null };
          const next = applyOutfitEdit(outfits[index], input, items);
          return { outfits: outfits.map((outfit, i) => (i === index ? next : outfit)), value: next };
        });
        if (!updated) return json(res, 404, { error: "Outfit not found" });
        return json(res, 200, outfitForClient(updated));
      }
      if (outfitMatch && req.method === "DELETE") {
        const id = outfitMatch[1];
        const removed = await updateOutfits((outfits) => {
          const found = outfits.find((outfit) => outfit.id === id);
          return found ? { outfits: outfits.filter((outfit) => outfit.id !== id), value: found } : { value: null };
        });
        if (!removed) return json(res, 404, { error: "Outfit not found" });
        if (typeof removed.image === "string") await rm(path.join(outfitAssetDir, path.basename(removed.image)), { force: true });
        return json(res, 200, { deleted: true, id });
      }
      const outfitAssetMatch = url.pathname.match(/^\/api\/import\/outfits\/([\w.-]+\.png)$/i);
      if (outfitAssetMatch && (req.method === "GET" || req.method === "HEAD")) {
        const file = path.join(outfitAssetDir, path.basename(outfitAssetMatch[1]));
        return await serveImageFile(req, res, file, "private, no-cache");
      }
      // A piece with its own PNG: a starter piece drawn in the app, or a phone cutout.
      if (url.pathname === "/api/import/wardrobe" && req.method === "POST") {
        requireJsonContentType(req);
        const input = await body(req, 12 * 1024 * 1024);
        const bytes = checkPng(decodeImage(input).data);
        const id = `import-${randomUUID()}`;
        const fileName = garmentFileName(id);
        await mkdir(libraryAssetDir, { recursive: true });
        await writeFile(path.join(libraryAssetDir, fileName), bytes);
        const record = newPieceRecord(input, id, `${LIBRARY_ASSET_ROOT}/${fileName}`);
        await updateLibrary((records) => ({ records: [...records, record], value: record }));
        return json(res, 201, record);
      }
      const imageMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})\/image$/i);
      if (imageMatch && req.method === "PUT") {
        requireJsonContentType(req);
        const id = imageMatch[1];
        const input = await body(req, 12 * 1024 * 1024);
        const exists = (await loadImported()).some((record) => record.id === id);
        if (!exists) return json(res, 404, { error: "Imported wardrobe item not found" });
        const bytes = checkPng(decodeImage(input).data);
        const fileName = garmentFileName(id);
        await mkdir(libraryAssetDir, { recursive: true });
        await writeFile(path.join(libraryAssetDir, fileName), bytes);
        let old = null;
        const updated = await updateLibrary((records) => {
          const index = records.findIndex((record) => record.id === id);
          if (index === -1) return { value: null };
          old = records[index].image;
          const next = [...records];
          next[index] = { ...records[index], image: `${LIBRARY_ASSET_ROOT}/${fileName}`, thumbnail: `${LIBRARY_ASSET_ROOT}/${fileName}` };
          return { records: next, value: next[index] };
        });
        if (!updated) { await rm(path.join(libraryAssetDir, fileName), { force: true }); return json(res, 404, { error: "Imported wardrobe item not found" }); }
        const oldName = typeof old === "string" ? path.basename(old) : "";
        if (oldName.startsWith(`${id}-garment`) && oldName !== fileName) await rm(path.join(libraryAssetDir, oldName), { force: true });
        return json(res, 200, updated);
      }
      const wardrobeItemMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})$/i);
      if (wardrobeItemMatch && req.method === "DELETE") {
        const id = wardrobeItemMatch[1];
        const deleted = await updateLibrary((records) => {
          const found = records.find((record) => record.id === id);
          return found ? { records: records.filter((record) => record.id !== id), value: found } : { value: null };
        });
        if (!deleted) return json(res, 404, { error: "Imported wardrobe item not found" });
        const ownImage = typeof deleted.image === "string" ? path.basename(deleted.image) : "";
        await Promise.all([
          ownImage.startsWith(`${id}-garment`) ? rm(path.join(libraryAssetDir, ownImage), { force: true }) : null,
          rm(path.join(libraryAssetDir, `${id}-garment.png`), { force: true }),
          rm(path.join(libraryAssetDir, `${id}-modeled.png`), { force: true }),
          pruneDeletedGarment(id),
        ]);
        return json(res, 200, { deleted: true, id });
      }
      if (wardrobeItemMatch && (req.method === "PATCH" || req.method === "PUT")) {
        requireJsonContentType(req);
        const id = wardrobeItemMatch[1];
        const input = await body(req, 64 * 1024);
        const updated = await updateLibrary((records) => {
          const index = records.findIndex((record) => record.id === id);
          if (index === -1) return { value: null };
          const record = normalizeItemEdit(records[index], input);
          const next = [...records];
          next[index] = record;
          return { records: next, value: record };
        });
        if (!updated) return json(res, 404, { error: "Imported wardrobe item not found" });
        return json(res, 200, updated);
      }
      const libraryAssetMatch = url.pathname.match(/^\/api\/import\/library\/([\w.-]+)$/i);
      if (libraryAssetMatch && (req.method === "GET" || req.method === "HEAD")) {
        const file = path.join(libraryAssetDir, path.basename(libraryAssetMatch[1]));
        return await serveImageFile(req, res, file, "private, max-age=31536000, immutable");
      }
      const assetMatch = url.pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
      if (assetMatch && (req.method === "GET" || req.method === "HEAD")) {
        const file = path.join(jobsDir, assetMatch[1], path.basename(assetMatch[2]));
        return await serveImageFile(req, res, file, "no-store");
      }
      if (url.pathname === API_ROOT && req.method === "POST") {
        requireJsonContentType(req);
        const ai = requireAi(await currentAi());
        const image = decodeImage(await body(req));
        const normalizedImage = await normalizeImage(image.data);
        const detected = await detectClothing(ai, { imageBase64: await imageForAi(normalizedImage), mediaType: "image/jpeg" });
        const jobs = [];
        // Share one original.png per multi-garment upload batch instead of duplicating it N times.
        const originalFile = "original.png";
        const batchId = detected.length > 1 ? randomUUID() : null;
        if (batchId) {
          const batchDir = path.join(jobsDir, batchId);
          await mkdir(batchDir, { recursive: true });
          await writeFile(path.join(batchDir, originalFile), normalizedImage);
        }
        for (const metadata of detected) {
          const id = randomUUID();
          const ownerId = batchId || id;
          const dir = path.join(jobsDir, id);
          await mkdir(dir, { recursive: true });
          const cropFile = "crop.png";
          if (!batchId) await writeFile(path.join(dir, originalFile), normalizedImage);
          await writeFile(path.join(dir, cropFile), await cropDetectedItem(normalizedImage, metadata.boundingBox));
          const now = new Date().toISOString();
          const cropStage = { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now };
          const job = {
            id,
            status: "active",
            metadata,
            stages: { crop: cropStage, garment: stageState() },
            createdAt: now,
            updatedAt: now,
            internal: { originalFile, cropFile, ...(batchId ? { originalBatchId: batchId } : {}) },
          };
          job.originalAssetUrl = `${ASSET_ROOT}/${ownerId}/${originalFile}`;
          await saveJob(job);
          jobs.push(publicJob(job));
        }
        return json(res, 202, { jobs, noClothingDetected: jobs.length === 0 });
      }
      if (url.pathname === API_ROOT && req.method === "GET") {
        const ids = await readdir(jobsDir).catch(() => []);
        const jobs = (await Promise.all(ids.map((id) => loadJob(id)))).filter((job) => job && job.status === "active" && !Object.values(job.stages).some((stage) => stage.status === "rejected"));
        return json(res, 200, jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(publicJob));
      }
      const match = url.pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
      if (!match) return json(res, 404, { error: "Not found" });
      const job = await loadJob(match[1]);
      if (!job) return json(res, 404, { error: "Job not found" });
      const action = match[2] || "";
      if (!action && req.method === "GET") return json(res, 200, publicJob(job));
      if (!action && req.method === "DELETE") {
        await removeJobFiles(job);
        return json(res, 200, { deleted: true, id: job.id });
      }
      if (action === "metadata" && (req.method === "PATCH" || req.method === "PUT")) {
        requireJsonContentType(req);
        const input = await body(req);
        if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw Object.assign(new Error("metadata must be an object"), { status: 400 });
        job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata }); await saveJob(job);
        return json(res, 200, publicJob(job));
      }
      const stageMatch = action.match(/^stages\/(crop|garment)\/(approve|reject|retry|use-crop)$/);
      if (stageMatch && req.method === "POST") {
        const [, stageName, decision] = stageMatch;
        const stage = job.stages[stageName];
        if (decision === "retry" || decision === "use-crop") {
          if (stageName !== "garment" || job.stages.crop.status !== "approved" || stage.status === "processing") throw Object.assign(new Error("The cutout cannot be redone right now"), { status: 409 });
          stage.status = "queued";
          await saveJob(job);
          void makeGarment(job, { keepBackground: decision === "use-crop" });
          return json(res, 202, publicJob(job));
        }
        if (stage.status !== "review") throw Object.assign(new Error("Stage is not ready for review"), { status: 409 });
        if (decision === "reject") {
          await removeJobFiles(job);
          return json(res, 200, publicJob({ ...job, stages: { ...job.stages, [stageName]: { ...stage, status: "rejected", decision: "rejected" } } }));
        }
        Object.assign(stage, { status: "approved", decision: "approved", error: null, updatedAt: new Date().toISOString() });
        if (stageName === "crop") {
          job.stages.garment.status = "queued";
          await saveJob(job);
          void makeGarment(job);
          return json(res, 200, publicJob(job));
        }
        job.status = "complete";
        await saveJob(job);
        let record;
        try {
          record = await persistImported(job);
        } catch (error) {
          Object.assign(stage, { status: "review", decision: null });
          job.status = "active";
          await saveJob(job);
          throw error;
        }
        await removeJobFiles(job);
        return json(res, 200, { ...publicJob(job), item: record });
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode = error.code === "ENOENT" ? 404 : error.status || 500;
      const message = statusCode === 500 ? "Internal server error" : error.message;
      if (statusCode >= 500) console.error(error);
      return json(res, statusCode, { error: message, ...(process.env.NODE_ENV === "development" && statusCode === 500 ? { detail: error.message } : {}) });
    }
  }

  async function init(projectRoot) {
    root = projectRoot;
    const dataDir = path.resolve(root, setting("WARDROBE_DATA_DIR", "data"));
    jobsDir = path.join(dataDir, "jobs");
    importedFile = path.join(dataDir, "library.json");
    libraryAssetDir = path.join(dataDir, "imported");
    outfitsFile = path.join(dataDir, "outfits.json");
    outfitAssetDir = path.join(dataDir, "outfit-images");
    settingsFile = path.join(dataDir, "settings.json");
    planFile = path.join(dataDir, "plan.json");
    await mkdir(jobsDir, { recursive: true });
    await mkdir(libraryAssetDir, { recursive: true });
    const ids = await readdir(jobsDir).catch(() => []);
    for (const id of ids) {
      const job = await loadJob(id);
      if (!job) continue;
      if (job.status === "complete") {
        try {
          await persistImported(job);
          await removeJobFiles(job);
        } catch {
          job.status = "active";
          Object.assign(job.stages.garment, { status: "review", decision: null, error: null });
          await saveJob(job);
        }
        continue;
      }
      // Jobs left over from the OpenAI version carry a "modeled" stage; the
      // garment they reached is still good, so keep it for review.
      if (job.stages.modeled) {
        delete job.stages.modeled;
        if (job.stages.garment.status === "approved") job.stages.garment.status = "review";
        await saveJob(job);
      }
      if (job.stages.crop?.status === "approved" && ["processing", "queued", "pending"].includes(job.stages.garment.status)) {
        job.stages.garment.status = "queued";
        await saveJob(job);
        void makeGarment(job);
      }
    }
  }

  return { init, handler };
}

export function wardrobeImportApi(options = {}) {
  const api = createWardrobeApi(options);
  return {
    name: "wardrobe-import-job-api",
    apply: "serve",
    async configResolved(config) { await api.init(config.root); },
    configureServer(server) { server.middlewares.use(api.handler); },
    configurePreviewServer(server) { server.middlewares.use(api.handler); },
  };
}
