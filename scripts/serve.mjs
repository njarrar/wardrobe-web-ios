// Production server: serves the built app from dist/ plus the wardrobe API.
// Run `npm run build` once, then `npm start`.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createWardrobeApi, isLoopbackHost } from "./import-job-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const env = { ...loadEnv("production", root, ""), ...process.env };
const host = env.WARDROBE_HOST || "127.0.0.1";
const port = Number(env.PORT || env.WARDROBE_PORT || 4173);

if (!isLoopbackHost(host) && !env.WARDROBE_TOKEN?.trim()) {
  console.error(`Refusing to listen on ${host} without WARDROBE_TOKEN. Set it in .env to share your wardrobe on your network.`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function sendFile(res, file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  createReadStream(file).pipe(res);
  return true;
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    return res.end();
  }
  const { pathname } = new URL(req.url, "http://localhost");
  const file = path.normalize(path.join(distDir, decodeURIComponent(pathname)));
  if (file.startsWith(distDir + path.sep) && await sendFile(res, file)) return;
  if (await sendFile(res, path.join(distDir, "index.html"))) return;
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("The app is not built yet. Run `npm run build`, then `npm start`.");
}

const api = createWardrobeApi({ env });
await api.init(root);

const server = http.createServer((req, res) => {
  api.handler(req, res, () => {
    serveStatic(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
});

server.listen(port, host, () => {
  console.log(`Wardrobe running at http://${host.includes(":") ? `[${host}]` : host}:${port}`);
});
