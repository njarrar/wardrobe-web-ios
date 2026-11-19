// The wardrobe API without a server. It answers the same requests as
// scripts/import-job-api.mjs and worker/index.js, using the same shared rules,
// but keeps everything in a store from ./store.js and calls the AI straight
// from the device with the key saved on it.
import {
  MAX_STYLE_COUNT,
  applyOutfitEdit,
  checkPng,
  garmentFileName,
  newPieceRecord,
  normalizeItemEdit,
  normalizeManualOutfit,
  normalizeMetadata,
  publicJob,
  sortFields,
  stageState,
  styleOptions,
} from "../../shared/core.mjs";
import { normalizePlan } from "../../shared/style.mjs";
import { AiError, applyAiSettingsEdit, detectClothing, publicAiSettings, requireAi, resolveAi, sortCloset, styleOutfits } from "../../shared/ai.mjs";
import { cropDetectedItem, decodePng, encodePng, frameTransparentGarment, resize } from "../../shared/pixels.mjs";
import { fromBase64, toBase64 } from "./store.js";

const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ROOT = "/api/import/library";
const OUTFIT_ROOT = "/api/import/outfits";
const AI_SECRET = "ai-settings";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function readBody(options) {
  const body = options.body;
  if (!body) return {};
  if (typeof body !== "string") throw new HttpError(400, "Expected a JSON request body");
  try { return JSON.parse(body); } catch { throw new HttpError(400, "Expected a JSON request body"); }
}

function dataUrlBytes(input) {
  const raw = input.imageDataUrl || input.imageBase64;
  if (!raw || typeof raw !== "string") throw new HttpError(400, "imageDataUrl or imageBase64 is required");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const bytes = fromBase64(match?.[2] || raw);
  if (!bytes.length) throw new HttpError(400, "Image payload is empty");
  return bytes;
}

// Maps an API picture link to its file in the store.
export function storePath(apiPath = "") {
  const path = String(apiPath).split(/[?#]/, 1)[0];
  let match = path.match(/^\/api\/import\/library\/([\w.-]+)$/);
  if (match) return `library/${match[1]}`;
  match = path.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
  if (match) return `jobs/${match[1]}/${match[2]}`;
  match = path.match(/^\/api\/import\/outfits\/([\w.-]+\.png)$/);
  if (match) return `outfits/${match[1]}`;
  return null;
}

const fileName = (path) => (typeof path === "string" ? path.split("/").pop() : "");

// options: store (./store.js), cutout(pngBytes) for the garment step (the
// iPhone's Vision cutout; without it the crop is kept), aiFetch for AI calls,
// version for /api/health.
export function createLocalApi({ store, cutout = null, aiFetch = null, version = "local", env = () => "" }) {
  let queue = Promise.resolve();
  // One change at a time, so two quick edits never undo each other.
  const serially = (task) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };

  const items = () => store.readJson("items.json", []);
  const outfits = () => store.readJson("outfits.json", []);
  const jobs = () => store.readJson("jobs.json", {});
  const aiSettings = async () => { try { return JSON.parse((await store.getSecret(AI_SECRET)) || "{}"); } catch { return {}; } };
  // Only tests pass env (to point the AI at a stand-in); the app passes none.
  const noEnv = env;
  const currentAi = async () => ({ ...resolveAi(await aiSettings(), noEnv), ...(aiFetch ? { fetch: aiFetch } : {}) });

  const editItems = (change) => serially(async () => {
    const result = await change(await items());
    if (result.items) await store.writeJson("items.json", result.items);
    return result.value;
  });
  const editOutfits = (change) => serially(async () => {
    const result = await change(await outfits());
    if (result.outfits) await store.writeJson("outfits.json", result.outfits);
    return result.value;
  });
  const editJobs = (change) => serially(async () => {
    const all = await jobs();
    const value = await change(all);
    await store.writeJson("jobs.json", all);
    return value;
  });

  async function setupStatus() {
    const ai = publicAiSettings(await aiSettings(), noEnv);
    const selected = ai.providers.find((entry) => entry.id === ai.provider);
    return { ready: ai.ready, hasApiKey: ai.ready, provider: ai.provider, providerName: selected.name, storage: store.kind, cutouts: Boolean(cutout), local: true };
  }

  async function makeGarment(jobId, keepBackground) {
    const job = (await jobs())[jobId];
    if (!job) return;
    const attempts = job.stages.garment.attempts + 1;
    await editJobs((all) => { if (all[jobId]) Object.assign(all[jobId].stages.garment, { status: "processing", decision: null, error: null, attempts }); });
    const outputName = `garment-${attempts}.png`;
    try {
      const crop = await store.readBytes(`jobs/${jobId}/crop.png`);
      let cut = crop;
      let kept = keepBackground || !cutout;
      if (!kept) {
        const result = await cutout(crop);
        if (result) cut = result; else kept = true;
      }
      await store.writeBytes(`jobs/${jobId}/${outputName}`, encodePng(frameTransparentGarment(decodePng(cut))));
      await editJobs((all) => {
        if (all[jobId]) Object.assign(all[jobId].stages.garment, { status: "review", assetUrl: `${ASSET_ROOT}/${jobId}/${outputName}`, keptBackground: kept, updatedAt: new Date().toISOString() });
      });
    } catch (error) {
      await editJobs((all) => { if (all[jobId]) Object.assign(all[jobId].stages.garment, { status: "failed", error: error.message, updatedAt: new Date().toISOString() }); });
    }
  }

  async function deleteJob(id) {
    await editJobs((all) => { delete all[id]; });
    await store.remove(`jobs/${id}`);
  }

  async function route(path, method, options) {
    const url = new URL(path, "http://local");
    const { pathname } = url;
    if (pathname === "/api/health") return json(200, { ok: true, app: "wardrobe", version, protected: false, local: true });
    if (pathname === "/api/import/image-key") return json(200, { key: null });
    if (pathname === "/api/import/config" && method === "GET") return json(200, await setupStatus());
    if (pathname === "/api/import/wardrobe" && method === "GET") return json(200, await items());
    if (pathname === "/api/import/outfits" && method === "GET") return json(200, await outfits());

    if (pathname === "/api/import/settings/ai" && method === "GET") return json(200, publicAiSettings(await aiSettings(), noEnv));
    if (pathname === "/api/import/settings/ai" && method === "PUT") {
      const next = applyAiSettingsEdit(await aiSettings(), readBody(options));
      await store.setSecret(AI_SECRET, JSON.stringify(next));
      return json(200, publicAiSettings(next, noEnv));
    }

    if (pathname === "/api/import/plan" && method === "GET") return json(200, normalizePlan(await store.readJson("plan.json", {})));
    if (pathname === "/api/import/plan" && method === "PUT") {
      const plan = normalizePlan(readBody(options));
      await serially(() => store.writeJson("plan.json", plan));
      return json(200, plan);
    }

    if (pathname === "/api/import/wardrobe/sort" && method === "POST") {
      const input = readBody(options);
      const all = await items();
      const todo = input.all ? all : all.filter((item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality);
      const sorted = todo.length ? await sortCloset(await currentAi(), todo) : [];
      const updated = await editItems((records) => {
        const changed = [];
        const next = records.map((record) => {
          const fields = sorted.find((entry) => entry.id === record.id);
          if (!fields) return record;
          const { id, ...rest } = fields;
          const merged = { ...record, ...rest };
          changed.push(merged);
          return merged;
        });
        return { items: next, value: changed };
      });
      return json(200, { items: updated });
    }

    if (pathname === "/api/import/outfits" && method === "POST") {
      const created = normalizeManualOutfit(readBody(options), await items());
      await editOutfits((list) => ({ outfits: [...list, created] }));
      return json(201, { outfit: created });
    }
    if (pathname === "/api/import/outfits/generate" && method === "POST") {
      const input = readBody(options);
      const count = Math.max(1, Math.min(MAX_STYLE_COUNT, Math.round(Number(input.count) || 4)));
      const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "";
      const all = await items();
      if (!all.some((item) => item.part === "upperbody") || !all.some((item) => item.part === "lowerbody")) {
        throw new HttpError(409, "Add at least one top and one bottom before styling outfits.");
      }
      const created = await styleOutfits(await currentAi(), { items: all, outfits: await outfits(), count, notes, ...styleOptions(input) });
      await editOutfits((list) => ({ outfits: [...list, ...created] }));
      return json(201, { outfits: created });
    }
    const outfitMatch = pathname.match(/^\/api\/import\/outfits\/([\w-]{1,80})$/i);
    if (outfitMatch && method === "PATCH") {
      const input = readBody(options);
      const updated = await editOutfits((list) => {
        const index = list.findIndex((outfit) => outfit.id === outfitMatch[1]);
        if (index === -1) return { value: null };
        const next = [...list];
        next[index] = applyOutfitEdit(list[index], input);
        return { outfits: next, value: next[index] };
      });
      return updated ? json(200, updated) : json(404, { error: "Outfit not found" });
    }
    if (outfitMatch && method === "DELETE") {
      const removed = await editOutfits((list) => {
        const found = list.find((outfit) => outfit.id === outfitMatch[1]);
        return found ? { outfits: list.filter((outfit) => outfit !== found), value: found } : { value: null };
      });
      if (!removed) return json(404, { error: "Outfit not found" });
      if (removed.image) await store.remove(`outfits/${fileName(removed.image)}`);
      return json(200, { deleted: true, id: removed.id });
    }

    if (pathname === "/api/import/wardrobe" && method === "POST") {
      const input = readBody(options);
      const bytes = checkPng(dataUrlBytes(input));
      const id = `import-${crypto.randomUUID()}`;
      const name = garmentFileName(id);
      await store.writeBytes(`library/${name}`, bytes);
      const record = newPieceRecord(input, id, `${LIBRARY_ROOT}/${name}`);
      await editItems((list) => ({ items: [...list, record] }));
      return json(201, record);
    }
    const imageMatch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})\/image$/i);
    if (imageMatch && method === "PUT") {
      const id = imageMatch[1];
      const bytes = checkPng(dataUrlBytes(readBody(options)));
      const name = garmentFileName(id);
      let old = "";
      const updated = await editItems(async (list) => {
        const index = list.findIndex((record) => record.id === id);
        if (index === -1) return { value: null };
        await store.writeBytes(`library/${name}`, bytes);
        old = fileName(list[index].image);
        const next = [...list];
        next[index] = { ...list[index], image: `${LIBRARY_ROOT}/${name}`, thumbnail: `${LIBRARY_ROOT}/${name}` };
        return { items: next, value: next[index] };
      });
      if (!updated) return json(404, { error: "Imported wardrobe item not found" });
      if (old.startsWith(`${id}-garment`) && old !== name) await store.remove(`library/${old}`);
      return json(200, updated);
    }
    const itemMatch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]{1,80})$/i);
    if (itemMatch && method === "DELETE") {
      const removed = await editItems((list) => {
        const found = list.find((record) => record.id === itemMatch[1]);
        return found ? { items: list.filter((record) => record !== found), value: found } : { value: null };
      });
      if (!removed) return json(404, { error: "Imported wardrobe item not found" });
      for (const image of [removed.image, removed.modeledImage]) {
        const path = storePath(image);
        if (path) await store.remove(path);
      }
      return json(200, { deleted: true, id: removed.id });
    }
    if (itemMatch && (method === "PATCH" || method === "PUT")) {
      const input = readBody(options);
      const updated = await editItems((list) => {
        const index = list.findIndex((record) => record.id === itemMatch[1]);
        if (index === -1) return { value: null };
        const next = [...list];
        next[index] = normalizeItemEdit(list[index], input);
        return { items: next, value: next[index] };
      });
      return updated ? json(200, updated) : json(404, { error: "Imported wardrobe item not found" });
    }

    const filePath = storePath(pathname);
    if (filePath && method === "GET") {
      const bytes = await store.readBytes(filePath);
      return bytes ? new Response(bytes, { headers: { "Content-Type": "image/png" } }) : json(404, { error: "Not found" });
    }

    if (pathname === "/api/import/jobs" && method === "POST") {
      const ai = requireAi(await currentAi());
      let image;
      try { image = decodePng(dataUrlBytes(readBody(options))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Send the photo as a PNG."); }
      const scale = Math.min(1, 1568 / Math.max(image.width, image.height));
      const small = scale < 1 ? resize(image, Math.round(image.width * scale), Math.round(image.height * scale)) : image;
      const detected = await detectClothing(ai, { imageBase64: toBase64(encodePng(small)), mediaType: "image/png" });
      const created = [];
      for (const metadata of detected) {
        const id = crypto.randomUUID();
        await store.writeBytes(`jobs/${id}/crop.png`, encodePng(cropDetectedItem(image, metadata.boundingBox)));
        const now = new Date().toISOString();
        const job = {
          id, status: "active", metadata,
          stages: { crop: { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/crop.png`, updatedAt: now }, garment: stageState() },
          createdAt: now, updatedAt: now, internal: { cropFile: "crop.png" },
        };
        await editJobs((all) => { all[id] = job; });
        created.push(publicJob(job));
      }
      return json(202, { jobs: created, noClothingDetected: created.length === 0 });
    }
    if (pathname === "/api/import/jobs" && method === "GET") {
      const all = await jobs();
      const list = Object.values(all).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const hidden = list.filter((job) => job.status === "complete" || Object.values(job.stages).some((stage) => stage.status === "rejected"));
      for (const job of hidden) await deleteJob(job.id);
      return json(200, list.filter((job) => !hidden.includes(job)).map(publicJob));
    }
    const jobMatch = pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
    if (jobMatch) {
      const job = (await jobs())[jobMatch[1]];
      if (!job) return json(404, { error: "Job not found" });
      const action = jobMatch[2] || "";
      if (!action && method === "GET") return json(200, publicJob(job));
      if (!action && method === "DELETE") { await deleteJob(job.id); return json(200, { deleted: true, id: job.id }); }
      if (action === "metadata" && (method === "PATCH" || method === "PUT")) {
        const input = readBody(options);
        if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw new HttpError(400, "metadata must be an object");
        const next = await editJobs((all) => { all[job.id].metadata = normalizeMetadata({ ...job.metadata, ...input.metadata }); return all[job.id]; });
        return json(200, publicJob(next));
      }
      const stageMatch = action.match(/^stages\/(crop|garment)\/(approve|reject|retry|use-crop)$/);
      if (stageMatch && method === "POST") {
        const [, stageName, decision] = stageMatch;
        const stage = job.stages[stageName];
        if (decision === "retry" || decision === "use-crop") {
          if (stageName !== "garment" || job.stages.crop.status !== "approved" || stage.status === "processing") throw new HttpError(409, "The cutout cannot be redone right now");
          const next = await editJobs((all) => { all[job.id].stages.garment.status = "queued"; return all[job.id]; });
          void makeGarment(job.id, decision === "use-crop");
          return json(202, publicJob(next));
        }
        if (stage.status !== "review") throw new HttpError(409, "Stage is not ready for review");
        if (decision === "reject") {
          await deleteJob(job.id);
          return json(200, publicJob({ ...job, stages: { ...job.stages, [stageName]: { ...stage, status: "rejected", decision: "rejected" } } }));
        }
        if (stageName === "crop") {
          const next = await editJobs((all) => {
            Object.assign(all[job.id].stages.crop, { status: "approved", decision: "approved", error: null, updatedAt: new Date().toISOString() });
            all[job.id].stages.garment.status = "queued";
            return all[job.id];
          });
          void makeGarment(job.id, false);
          return json(200, publicJob(next));
        }
        const id = `import-${job.id}`;
        const name = garmentFileName(id);
        await store.writeBytes(`library/${name}`, await store.readBytes(storePath(stage.assetUrl)));
        const metadata = job.metadata || {};
        const record = {
          ...newPieceRecord(metadata, id, `${LIBRARY_ROOT}/${name}`),
          ...sortFields(metadata),
          importJobId: job.id,
        };
        await editItems((list) => ({ items: [...list.filter((entry) => entry.id !== id), record] }));
        await deleteJob(job.id);
        return json(200, { ...publicJob({ ...job, status: "complete" }), item: record });
      }
    }
    return json(404, { error: "Not found" });
  }

  return {
    store,
    async handle(path, options = {}) {
      const method = (options.method || "GET").toUpperCase();
      try {
        return await route(path, method, options);
      } catch (error) {
        const status = error instanceof HttpError || error instanceof AiError || (error.status >= 400 && error.status < 600) ? error.status : 500;
        return json(status, { error: error.message || "Something went wrong" });
      }
    },
    assetUrl(path) {
      const file = storePath(path);
      return file ? store.fileUrl(file) : path;
    },
  };
}
