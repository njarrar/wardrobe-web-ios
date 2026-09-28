// Copies the local closet in data/ up to your Cloudflare Worker.
// Usage: node scripts/upload-to-cloudflare.mjs https://wardrobe.you.workers.dev
// Reads WARDROBE_TOKEN from .env (or the environment). Safe to run again:
// items and outfits with the same id are updated, not duplicated.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...loadEnv("production", root, ""), ...process.env };
const server = (process.argv[2] || env.WARDROBE_CLOUD_URL || "").replace(/\/+$/, "");
const token = env.WARDROBE_CLOUD_TOKEN || env.WARDROBE_TOKEN;
const dataDir = path.resolve(root, env.WARDROBE_DATA_DIR || "data");

if (!server || !token) {
  console.error("Usage: node scripts/upload-to-cloudflare.mjs https://your-worker.workers.dev (with WARDROBE_TOKEN set)");
  process.exit(1);
}

async function readOptional(file) {
  try { return await readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function send(route, method, payload) {
  const response = await fetch(`${server}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: ${value.error || response.status}`);
  return value;
}

const localAsset = (url) => url ? path.join(dataDir, "imported", path.basename(url)) : null;

const library = JSON.parse(await readOptional(path.join(dataDir, "library.json")) || "[]");
let items = 0;
for (const record of library) {
  const garment = await readOptional(localAsset(record.image));
  if (!garment) {
    console.warn(`Skipping ${record.id}: no garment image`);
    continue;
  }
  const modeled = record.modeledImage ? await readOptional(localAsset(record.modeledImage)) : null;
  await send("/api/import/sync/item", "POST", {
    record,
    garmentBase64: garment.toString("base64"),
    modeledBase64: modeled?.toString("base64"),
  });
  items += 1;
  console.log(`Uploaded ${record.name || record.id}`);
}

const outfitFile = JSON.parse(await readOptional(path.join(dataDir, "outfits.json")) || "[]");
const outfits = Array.isArray(outfitFile) ? outfitFile : outfitFile.outfits || [];
for (const outfit of outfits) {
  const image = outfit.image ? await readOptional(path.join(dataDir, "outfit-images", path.basename(outfit.image))) : null;
  await send("/api/import/sync/outfit", "POST", { outfit, imageBase64: image?.toString("base64") });
  console.log(`Uploaded outfit ${outfit.name || outfit.id}`);
}

const referencePath = path.resolve(root, env.WARDROBE_MODEL_REFERENCE || "data/model-reference.png");
const reference = await readOptional(referencePath);
if (reference) {
  await send("/api/import/model-reference", "PUT", { imageDataUrl: `data:image/png;base64,${reference.toString("base64")}` });
  console.log("Uploaded your model reference photo");
}

console.log(`Done: ${items} items, ${outfits.length} outfits.`);
