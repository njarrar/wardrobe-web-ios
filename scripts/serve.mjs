// Production server: serves the built app from dist/ plus the wardrobe API.
// Run `npm run build` once, then `npm start`. This is also what the Docker
// image (and so the Synology NAS container) runs.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createWardrobeApi, isLoopbackHost } from "./import-job-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

// In the container the entrypoint starts us as root to fix folder ownership;
// switch to the NAS user before any file is created.
if (process.getuid?.() === 0 && process.env.PUID) {
  const uid = Number(process.env.PUID);
  const gid = Number(process.env.PGID || process.env.PUID);
  if (Number.isInteger(uid) && Number.isInteger(gid) && uid > 0) {
    process.setgroups?.([gid]);
    process.setgid(gid);
    process.setuid(uid);
  }
}

const env = { ...loadEnv("production", root, ""), ...process.env };
const host = env.WARDROBE_HOST || "127.0.0.1";
const port = Number(env.PORT || env.WARDROBE_PORT || 4173);
const version = await readFile(path.join(root, "package.json"), "utf8").then((text) => JSON.parse(text).version).catch(() => "unknown");

if (!isLoopbackHost(host) && !env.WARDROBE_TOKEN?.trim()) {
  console.error(`Refusing to listen on ${host} without WARDROBE_TOKEN. Set it in .env (or the container environment) to share your wardrobe on your network.`);
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
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

async function sendFile(res, file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
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

const api = createWardrobeApi({ env, version });
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

// Big photo uploads from phones on slow Wi-Fi need more than Node's default.
server.requestTimeout = 5 * 60 * 1000;

server.listen(port, host, () => {
  console.log(`Wardrobe ${version} running at http://${host.includes(":") ? `[${host}]` : host}:${port}`);
  console.log(`Data directory: ${path.resolve(root, env.WARDROBE_DATA_DIR || "data")}`);
});

// `docker stop` (and Synology's Stop button) sends SIGTERM. Finish in-flight
// requests so a half-written library.json is never left behind.
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}, shutting down…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
