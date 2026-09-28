import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  MAX_STYLE_COUNT,
  isLoopbackHost,
  normalizeBoundingBox,
  applyOutfitEdit,
  normalizeItemEdit,
  normalizeManualOutfit,
  normalizeMetadata,
  publicJob,
  stageState,
  tokensMatch,
} from "../shared/core.mjs";
import { CLAUDE_IMAGE_EDGE, createClaude, detectClothing, styleOutfits } from "../shared/claude.mjs";

export { isLoopbackHost };

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
export const DEFAULT_CUTOUT_MODEL = "onnx-community/BiRefNet_lite";

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
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

// Claude reads images up to 1568px on the long edge; send a JPEG that size.
async function imageForClaude(bytes) {
  const data = await sharp(bytes).resize(CLAUDE_IMAGE_EDGE, CLAUDE_IMAGE_EDGE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  return data.toString("base64");
}

// Local background removal runs a small open model through transformers.js.
// It is an optional install, so the import falls back to the plain crop when
// it is missing (see the "use-crop" action).
let cutoutPipeline = null;
export async function removeBackground(bytes, model, { cacheDir } = {}) {
  if (!cutoutPipeline) {
    cutoutPipeline = (async () => {
      let transformers;
      try { transformers = await import("@huggingface/transformers"); }
      catch { throw new Error("Background removal is not installed. Run npm install @huggingface/transformers, or use the crop as is."); }
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        transformers.env.cacheDir = cacheDir;
      }
      return transformers.pipeline("background-removal", model, { dtype: "fp32" }).then((run) => ({ run, RawImage: transformers.RawImage }));
    })();
    cutoutPipeline.catch(() => { cutoutPipeline = null; });
  }
  const { run, RawImage } = await cutoutPipeline;
  const input = await RawImage.fromBlob(new Blob([bytes], { type: "image/png" }));
  const output = (await run(input)).rgba();
  return sharp(Buffer.from(output.data), { raw: { width: output.width, height: output.height, channels: 4 } }).png().toBuffer();
}

async function atomicJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(tmp, file);
  } catch (error) {
    if (!["EBUSY", "EXDEV", "EPERM"].includes(error.code)) {
      await rm(tmp, { force: true });
      throw error;
    }
    await copyFile(tmp, file);
    await rm(tmp, { force: true });
  }
}

export function createWardrobeApi(options = {}) {
  let root;
  let jobsDir;
  let importedFile;
  let libraryAssetDir;
  let outfitsFile;
  let outfitAssetDir;
  let writeQueue = Promise.resolve();
  let claude = null;
  const running = new Map();
  const setting = (name, fallback = "") => options.env?.[name] || process.env[name] || fallback;
  const claudeModel = () => setting("WARDROBE_CLAUDE_MODEL");
  const cutout = options.removeBackground || ((bytes) => removeBackground(bytes, setting("WARDROBE_CUTOUT_MODEL", DEFAULT_CUTOUT_MODEL), { cacheDir: setting("WARDROBE_MODEL_CACHE") || undefined }));

  function claudeClient() {
    const apiKey = setting("ANTHROPIC_API_KEY").trim();
    if (!apiKey) throw Object.assign(new Error("Setup required: add ANTHROPIC_API_KEY to .env, then restart the app."), { status: 503 });
    if (!claude) claude = createClaude({ apiKey, baseURL: setting("ANTHROPIC_BASE_URL") || undefined });
    return claude;
  }

  async function setupStatus() {
    const hasApiKey = Boolean(setting("ANTHROPIC_API_KEY").trim());
    return { ready: hasApiKey, hasApiKey, storage: "local" };
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

  async function loadImported() {
    try { return JSON.parse(await readFile(importedFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  // Every read-modify-write of library.json and outfits.json runs through this
  // queue so two changes landing at once cannot drop each other.
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

  // Older outfits may carry a photo in data/outfit-images; new ones are a
  // collage of the garment cutouts drawn by the app.
  function outfitForClient(outfit) {
    const fileName = typeof outfit.image === "string" ? path.basename(outfit.image) : null;
    return { ...outfit, image: fileName ? `${OUTFIT_ASSET_ROOT}/${fileName}` : null };
  }

  function authorize(req, url) {
    const token = setting("WARDROBE_TOKEN").trim();
    if (!token) return isLoopbackHost(req.headers.host);
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    return tokensMatch(token, bearer) || tokensMatch(token, url.searchParams.get("token"));
  }

  function applyCors(req, res) {
    // Cross-origin access is only opened up when a token guards the API, so
    // a random web page cannot drive the local server through the browser.
    if (!setting("WARDROBE_TOKEN").trim()) return;
    res.setHeader("Access-Control-Allow-Origin", "*");
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
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, { ok: true, app: "wardrobe", version: options.version || "dev", protected: Boolean(setting("WARDROBE_TOKEN").trim()) });
  }

  async function handler(req, res, next) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") return health(req, res);
    if (!url.pathname.startsWith("/api/import/")) return next();
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    if (!authorize(req, url)) return json(res, 401, { error: "Wardrobe access token required" });
    try {
      if (url.pathname === "/api/import/wardrobe" && req.method === "GET") {
        return json(res, 200, await loadImported());
      }
      if (url.pathname === "/api/import/config" && req.method === "GET") {
        return json(res, 200, await setupStatus());
      }
      if (url.pathname === "/api/import/outfits" && req.method === "GET") {
        return json(res, 200, (await loadOutfitRecords()).map(outfitForClient));
      }
      if (url.pathname === "/api/import/outfits" && req.method === "POST") {
        const created = normalizeManualOutfit(await body(req, 64 * 1024), await loadImported());
        await updateOutfits((outfits) => ({ outfits: [created, ...outfits] }));
        return json(res, 201, { outfit: outfitForClient(created) });
      }
      if (url.pathname === "/api/import/outfits/generate" && req.method === "POST") {
        const input = await body(req, 64 * 1024);
        const count = Math.max(1, Math.min(MAX_STYLE_COUNT, Math.round(Number(input.count) || 4)));
        const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "";
        const items = await loadImported();
        if (!items.some((item) => item.part === "upperbody") || !items.some((item) => item.part === "lowerbody")) {
          throw Object.assign(new Error("Add at least one top and one bottom before styling outfits."), { status: 409 });
        }
        const client = claudeClient();
        const existing = await loadOutfitRecords();
        const created = await styleOutfits(client, { model: claudeModel(), items, outfits: existing, count, notes });
        await updateOutfits((outfits) => ({ outfits: [...outfits, ...created] }));
        return json(res, 201, { outfits: created.map(outfitForClient) });
      }
      const outfitMatch = url.pathname.match(/^\/api\/import\/outfits\/([\w-]{1,80})$/i);
      if (outfitMatch && req.method === "PATCH") {
        const id = outfitMatch[1];
        const input = await body(req, 64 * 1024);
        const updated = await updateOutfits((outfits) => {
          const index = outfits.findIndex((outfit) => outfit.id === id);
          if (index === -1) return { value: null };
          const next = applyOutfitEdit(outfits[index], input);
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
      if (outfitAssetMatch && req.method === "GET") {
        const file = path.join(outfitAssetDir, path.basename(outfitAssetMatch[1]));
        await stat(file);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-cache");
        return res.end(await readFile(file));
      }
      const wardrobeItemMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})$/i);
      if (wardrobeItemMatch && req.method === "DELETE") {
        const id = wardrobeItemMatch[1];
        const deleted = await updateLibrary((records) => {
          const next = records.filter((record) => record.id !== id);
          return next.length === records.length ? { value: false } : { records: next, value: true };
        });
        if (!deleted) return json(res, 404, { error: "Imported wardrobe item not found" });
        await Promise.all([
          rm(path.join(libraryAssetDir, `${id}-garment.png`), { force: true }),
          rm(path.join(libraryAssetDir, `${id}-modeled.png`), { force: true }),
        ]);
        return json(res, 200, { deleted: true, id });
      }
      if (wardrobeItemMatch && (req.method === "PATCH" || req.method === "PUT")) {
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
      if (libraryAssetMatch && req.method === "GET") {
        const file = path.join(libraryAssetDir, path.basename(libraryAssetMatch[1]));
        await stat(file);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.end(await readFile(file));
      }
      const assetMatch = url.pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
      if (assetMatch && req.method === "GET") {
        const file = path.join(jobsDir, assetMatch[1], path.basename(assetMatch[2]));
        await stat(file);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.end(await readFile(file));
      }
      if (url.pathname === API_ROOT && req.method === "POST") {
        const client = claudeClient();
        const image = decodeImage(await body(req));
        const normalizedImage = await normalizeImage(image.data);
        const detected = await detectClothing(client, { model: claudeModel(), imageBase64: await imageForClaude(normalizedImage), mediaType: "image/jpeg" });
        const jobs = [];
        for (const metadata of detected) {
          const id = randomUUID();
          const dir = path.join(jobsDir, id); await mkdir(dir, { recursive: true });
          const originalFile = "original.png";
          const cropFile = "crop.png";
          await writeFile(path.join(dir, originalFile), normalizedImage);
          await writeFile(path.join(dir, cropFile), await cropDetectedItem(normalizedImage, metadata.boundingBox));
          const now = new Date().toISOString();
          const cropStage = { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now };
          const job = { id, status: "active", metadata, stages: { crop: cropStage, garment: stageState() }, createdAt: now, updatedAt: now, internal: { originalFile, cropFile } };
          job.originalAssetUrl = `${ASSET_ROOT}/${id}/${originalFile}`;
          await saveJob(job); jobs.push(publicJob(job));
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
        await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
        return json(res, 200, { deleted: true, id: job.id });
      }
      if (action === "metadata" && (req.method === "PATCH" || req.method === "PUT")) {
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
          await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
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
        await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
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
    await mkdir(jobsDir, { recursive: true });
    await mkdir(libraryAssetDir, { recursive: true });
    const ids = await readdir(jobsDir).catch(() => []);
    for (const id of ids) {
      const job = await loadJob(id);
      if (!job) continue;
      if (job.status === "complete") {
        try {
          await persistImported(job);
          await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
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
