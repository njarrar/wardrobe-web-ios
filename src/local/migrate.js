// Copies a closet from the server into the iCloud closet: pieces, pictures,
// outfits and the plan. The server keeps its copy; nothing is deleted.
import { apiFetch } from "../api.js";
import { storePath } from "./backend.js";
import { createNativeStore, createWebStore } from "./store.js";

async function getJson(path) {
  const response = await apiFetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`The server said ${response.status} for ${path}`);
  return response.json();
}

async function copyPicture(store, path) {
  const target = storePath(path);
  if (!target) return;
  const response = await apiFetch(path);
  if (!response.ok) return;
  await store.writeBytes(target, new Uint8Array(await response.arrayBuffer()));
}

export async function copyServerToLocal(onProgress = () => {}) {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  const store = native ? await createNativeStore() : await createWebStore();
  const items = await getJson("/api/import/wardrobe");
  const outfits = await getJson("/api/import/outfits");
  const plan = await getJson("/api/import/plan").catch(() => null);
  const total = items.length + outfits.length;
  let done = 0;
  for (const item of items) {
    await copyPicture(store, item.image);
    if (item.thumbnail && item.thumbnail !== item.image) await copyPicture(store, item.thumbnail);
    if (item.modeledImage) await copyPicture(store, item.modeledImage);
    onProgress(++done, total);
  }
  for (const outfit of outfits) {
    if (outfit.image) await copyPicture(store, outfit.image);
    onProgress(++done, total);
  }
  const existing = await store.readJson("items.json", []);
  const ids = new Set(items.map((item) => item.id));
  await store.writeJson("items.json", [...existing.filter((item) => !ids.has(item.id)), ...items]);
  const outfitIds = new Set(outfits.map((outfit) => outfit.id));
  await store.writeJson("outfits.json", [...(await store.readJson("outfits.json", [])).filter((outfit) => !outfitIds.has(outfit.id)), ...outfits]);
  if (plan) await store.writeJson("plan.json", plan);
  return { pieces: items.length, outfits: outfits.length, kind: store.kind };
}
