// Copies the local closet in data/ up to your Cloudflare Worker.
// Usage: node scripts/upload-to-cloudflare.mjs https://wardrobe.you.workers.dev
// Reads WARDROBE_TOKEN from .env (or the environment). Safe to run again:
// items, outfits and plan are updated, not duplicated.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(dir, mode = "production") {
  const loaded = {};
  const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
  for (const name of files) {
    let text;
    try { text = readFileSync(path.join(dir, name), "utf8"); }
    catch { continue; }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      let [, key, value] = match;
      value = value.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        const quote = value[0];
        value = value.slice(1, -1);
        if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      loaded[key] = value;
    }
  }
  return loaded;
}

const env = { ...loadDotEnv(root, "production"), ...process.env };
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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

async function send(route, method, payload) {
  const body = JSON.stringify(payload);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${server}${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const value = await response.json().catch(() => ({}));
      if (response.ok) return value;
      lastError = new Error(`${route}: ${value.error || response.status}`);
      // A 4xx (other than 429) will fail again, so stop now.
      if (response.status < 500 && response.status !== 429) throw lastError;
    } catch (error) {
      if (error === lastError) throw error;
      lastError = error.name === "AbortError" ? new Error(`${route}: timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_RETRIES) {
      const delayMs = 1000 * (2 ** (attempt - 1));
      console.warn(`Retrying ${route} (attempt ${attempt + 1}/${MAX_RETRIES}) in ${delayMs}ms: ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const localAsset = (url) => url ? path.join(dataDir, "imported", path.basename(url)) : null;

const library = JSON.parse(await readOptional(path.join(dataDir, "library.json")) || "[]");
let items = 0;
const skipped = [];
for (const record of library) {
  const garment = await readOptional(localAsset(record.image));
  if (!garment) {
    const label = record.name ? `${record.name} (${record.id})` : record.id;
    skipped.push(label);
    console.warn(`Skipping ${label}: no garment image`);
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

const planRaw = await readOptional(path.join(dataDir, "plan.json"));
let planUploaded = false;
if (planRaw) {
  const plan = JSON.parse(planRaw.toString("utf8"));
  await send("/api/import/plan", "PUT", plan);
  planUploaded = true;
  console.log("Uploaded plan.json");
}

console.log(`Done: ${items} items, ${outfits.length} outfits, plan: ${planUploaded ? "uploaded" : "none"}${skipped.length ? `, skipped ${skipped.length} item(s): ${skipped.join(", ")}` : ""}.`);
