import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createWardrobeApi, isLoopbackHost } from "../scripts/import-job-api.mjs";

async function startServer(env) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-test-"));
  const api = createWardrobeApi({ env: { WARDROBE_DATA_DIR: "data", OPENAI_API_KEY: "", ...env } });
  await api.init(root);
  const server = http.createServer((req, res) => api.handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { root, base, dataDir: path.join(root, "data"), close: async () => { server.close(); await rm(root, { recursive: true, force: true }); } };
}

const item = (id, extra = {}) => ({ id, name: id, part: "upperbody", color: "#112233", secondaryColor: null, palette: ["#112233"], tags: [], image: `/api/import/library/${id}-garment.png`, ...extra });

describe("wardrobe api without a token", () => {
  let ctx;
  before(async () => {
    ctx = await startServer({});
    await writeFile(path.join(ctx.dataDir, "library.json"), JSON.stringify([item("import-a"), item("import-b")]));
  });
  after(() => ctx.close());

  test("lists the library", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((entry) => entry.id), ["import-a", "import-b"]);
  });

  test("saves edits to library.json", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe/import-a`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: " Navy tee ", color: "#AABBCC", tags: ["cotton", "cotton", " crew "] }),
    });
    assert.equal(response.status, 200);
    const stored = JSON.parse(await readFile(path.join(ctx.dataDir, "library.json"), "utf8"));
    const saved = stored.find((entry) => entry.id === "import-a");
    assert.equal(saved.name, "Navy tee");
    assert.equal(saved.color, "#aabbcc");
    assert.deepEqual(saved.tags, ["cotton", "crew"]);
  });

  test("rejects bad edits", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe/import-a`, { method: "PATCH", body: JSON.stringify({ color: "red" }) });
    assert.equal(response.status, 400);
  });

  test("keeps every change when edits land at the same time", async () => {
    await Promise.all(["import-a", "import-b"].flatMap((id) => [1, 2, 3].map((n) =>
      fetch(`${ctx.base}/api/import/wardrobe/${id}`, { method: "PATCH", body: JSON.stringify({ tags: [`${id}-${n}`] }) }))));
    await Promise.all([
      fetch(`${ctx.base}/api/import/wardrobe/import-a`, { method: "PATCH", body: JSON.stringify({ name: "A final" }) }),
      fetch(`${ctx.base}/api/import/wardrobe/import-b`, { method: "PATCH", body: JSON.stringify({ name: "B final" }) }),
    ]);
    const stored = JSON.parse(await readFile(path.join(ctx.dataDir, "library.json"), "utf8"));
    assert.deepEqual(stored.map((entry) => entry.name).sort(), ["A final", "B final"]);
  });

  test("deletes an item", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe/import-b`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const stored = JSON.parse(await readFile(path.join(ctx.dataDir, "library.json"), "utf8"));
    assert.deepEqual(stored.map((entry) => entry.id), ["import-a"]);
  });

  test("serves outfits written by the outfit skill", async () => {
    await mkdir(path.join(ctx.dataDir, "outfit-images"), { recursive: true });
    await writeFile(path.join(ctx.dataDir, "outfit-images", "navy-look.png"), Buffer.from([137, 80, 78, 71]));
    await writeFile(path.join(ctx.dataDir, "outfits.json"), JSON.stringify({ version: 1, outfits: [{ id: "navy-look", name: "Navy look", garmentIds: ["import-a"], image: "outfit-images/navy-look.png" }] }));
    const outfits = await (await fetch(`${ctx.base}/api/import/outfits`)).json();
    assert.equal(outfits[0].image, "/api/import/outfits/navy-look.png");
    const image = await fetch(`${ctx.base}${outfits[0].image}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
  });

  test("returns an empty outfit list when none exist", async () => {
    await rm(path.join(ctx.dataDir, "outfits.json"));
    assert.deepEqual(await (await fetch(`${ctx.base}/api/import/outfits`)).json(), []);
  });

  test("refuses requests addressed to a non-local host name", async () => {
    // fetch() ignores a custom Host header, so use a raw request.
    const status = await new Promise((resolve, reject) => {
      http.get(`${ctx.base}/api/import/wardrobe`, { headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(status, 401);
  });

  test("sends no CORS headers without a token", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe`);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

describe("wardrobe api with a token", () => {
  let ctx;
  before(async () => { ctx = await startServer({ WARDROBE_TOKEN: "s3cret" }); });
  after(() => ctx.close());

  test("rejects requests without the token", async () => {
    assert.equal((await fetch(`${ctx.base}/api/import/wardrobe`)).status, 401);
    assert.equal((await fetch(`${ctx.base}/api/import/wardrobe`, { headers: { Authorization: "Bearer nope" } })).status, 401);
  });

  test("accepts the token as a header or query parameter", async () => {
    assert.equal((await fetch(`${ctx.base}/api/import/wardrobe`, { headers: { Authorization: "Bearer s3cret" } })).status, 200);
    assert.equal((await fetch(`${ctx.base}/api/import/wardrobe?token=s3cret`)).status, 200);
  });

  test("answers CORS preflight for the iOS app", async () => {
    const response = await fetch(`${ctx.base}/api/import/wardrobe`, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("isLoopbackHost", () => {
  for (const host of ["localhost", "localhost:5173", "127.0.0.1:4173", "[::1]:4173", "::1", "app.localhost"]) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["0.0.0.0", "192.168.1.5:4173", "evil.example", ""]) assert.equal(isLoopbackHost(host), false, host);
});

test("uploads a model reference photo", async () => {
  const ctx = await startServer({ OPENAI_API_KEY: "sk-test" });
  try {
    const before = await (await fetch(`${ctx.base}/api/import/config`)).json();
    assert.equal(before.hasModelReference, false);
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#aa8866" } }).png().toBuffer();
    const response = await fetch(`${ctx.base}/api/import/model-reference`, { method: "PUT", body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${png.toString("base64")}` }) });
    const after = await response.json();
    assert.equal(after.ready, true);
    assert.equal((await readFile(path.join(ctx.dataDir, "model-reference.png"))).subarray(1, 4).toString(), "PNG");
  } finally {
    await ctx.close();
  }
});
