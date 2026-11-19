// Copies a closet from the server into the iCloud closet: pieces, pictures,
// outfits and the plan. The server keeps its copy; nothing is deleted.
import { apiFetch } from "../api.js";
import { mergePlans, stampChanges } from "../../shared/merge.mjs";
import { storePath } from "./backend.js";
import { createNativeStore, createWebStore } from "./store.js";

async function getJson(path) {
  const response = await apiFetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`The server said ${response.status} for ${path}`);
  return response.json();
}

// True when the picture is in the store afterwards. Tries three times, and
// skips pictures an earlier run already copied.
async function copyPicture(store, path) {
  const target = storePath(path);
  if (!target) return true;
  if (await store.readBytes(target)) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await apiFetch(path);
      if (response.ok) { await store.writeBytes(target, new Uint8Array(await response.arrayBuffer())); return true; }
      if (response.status === 404) return false;
    } catch { /* try again */ }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return false;
}

export async function copyServerToLocal(onProgress = () => {}) {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  const store = native ? await createNativeStore() : await createWebStore();
  const items = await getJson("/api/import/wardrobe");
  const outfits = await getJson("/api/import/outfits");
  const plan = await getJson("/api/import/plan").catch(() => null);
  const total = items.length + outfits.length;
  let done = 0;
  let failed = 0;
  const copy = async (path) => { if (path && !(await copyPicture(store, path))) failed += 1; };
  for (const item of items) {
    await copy(item.image);
    if (item.thumbnail !== item.image) await copy(item.thumbnail);
    await copy(item.modeledImage);
    onProgress(++done, total);
  }
  for (const outfit of outfits) {
    await copy(outfit.image);
    onProgress(++done, total);
  }
  // Nothing is written to the closet lists unless every picture came over.
  if (failed) return { pieces: items.length, outfits: outfits.length, kind: store.kind, failed };
  const now = new Date().toISOString();
  const existing = await store.readJson("items.json", []);
  const ids = new Set(items.map((item) => item.id));
  const mergedItems = stampChanges(existing, [...existing.filter((item) => !ids.has(item.id)), ...items], now).list;
  await store.writeJson("items.json", mergedItems);
  const existingOutfits = await store.readJson("outfits.json", []);
  const outfitIds = new Set(outfits.map((outfit) => outfit.id));
  const mergedOutfits = stampChanges(existingOutfits, [...existingOutfits.filter((outfit) => !outfitIds.has(outfit.id)), ...outfits], now).list;
  await store.writeJson("outfits.json", mergedOutfits);
  if (plan) {
    const existingPlan = await store.readJson("plan.json", null);
    await store.writeJson("plan.json", existingPlan ? mergePlans([existingPlan, plan]) : plan);
  }
  return { pieces: items.length, outfits: outfits.length, kind: store.kind, failed: 0 };
}
