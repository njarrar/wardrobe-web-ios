import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createWardrobeApi, isLoopbackHost } from "../scripts/import-job-api.mjs";
import { startMockClaude } from "./mock-claude.mjs";

async function startServer(env, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-test-"));
  const api = createWardrobeApi({ env: { WARDROBE_DATA_DIR: "data", ANTHROPIC_API_KEY: "", ...env }, ...options });
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

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out");
}

describe("importing and styling with Claude", () => {
  let ctx;
  let claude;
  const post = (url, value) => fetch(`${ctx.base}${url}`, { method: "POST", body: value === undefined ? undefined : JSON.stringify(value) });
  before(async () => {
    claude = await startMockClaude();
    const sharp = (await import("sharp")).default;
    // Pretend background removal: make the pure-white border transparent.
    const removeBackground = async (bytes) => {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let index = 0; index < data.length; index += 4) if (data[index] > 240 && data[index + 1] > 240 && data[index + 2] > 240) data[index + 3] = 0;
      return sharp(data, { raw: info }).png().toBuffer();
    };
    ctx = await startServer({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: claude.url }, { removeBackground });
  });
  after(async () => { await ctx.close(); await claude.close(); });

  test("reports setup as ready once the Anthropic key is set", async () => {
    const config = await (await fetch(`${ctx.base}/api/import/config`)).json();
    assert.equal(config.ready, true);
  });

  test("finds clothes, cuts them out and adds them to the library", async () => {
    const sharp = (await import("sharp")).default;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#fff"/><rect x="80" y="60" width="240" height="200" fill="#1f2a44"/><rect x="100" y="320" width="200" height="260" fill="#3b5b8c"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const response = await post("/api/import/jobs", { imageDataUrl: `data:image/png;base64,${png.toString("base64")}` });
    assert.equal(response.status, 202);
    const { jobs } = await response.json();
    assert.deepEqual(jobs.map((job) => job.metadata.name), ["Navy tee", "Blue jeans"]);
    assert.equal(jobs[0].metadata.color, "#1f2a44");
    assert.equal(jobs[1].metadata.secondaryColor, null);
    assert.equal(jobs[0].stages.modeled, undefined);

    const sent = claude.requests[0];
    assert.equal(sent.body.model, "claude-opus-5");
    assert.equal(sent.body.fallbacks, "default");
    assert.match(sent.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(sent.body.output_config.format.type, "json_schema");
    assert.equal(sent.body.messages[0].content[0].source.media_type, "image/jpeg");

    for (const job of jobs) assert.equal((await post(`/api/import/jobs/${job.id}/stages/crop/approve`)).status, 200);
    const ready = await waitFor(async () => {
      const job = await (await fetch(`${ctx.base}/api/import/jobs/${jobs[0].id}`)).json();
      return job.stages.garment.status === "review" && job;
    });
    const cutout = await sharp(await (await fetch(`${ctx.base}${ready.stages.garment.assetUrl}`)).arrayBuffer()).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    assert.equal(cutout.info.width, 1024);
    assert.equal(cutout.data[3], 0, "corner should be transparent");

    const approved = await (await post(`/api/import/jobs/${jobs[0].id}/stages/garment/approve`)).json();
    assert.equal(approved.item.id, `import-${jobs[0].id}`);
    assert.equal((await fetch(`${ctx.base}/api/import/jobs/${jobs[0].id}`)).status, 404);

    // Keep the second piece with its background to cover the fallback path.
    await waitFor(async () => (await (await fetch(`${ctx.base}/api/import/jobs/${jobs[1].id}`)).json()).stages.garment.status === "review");
    assert.equal((await post(`/api/import/jobs/${jobs[1].id}/stages/garment/use-crop`)).status, 202);
    const kept = await waitFor(async () => {
      const job = await (await fetch(`${ctx.base}/api/import/jobs/${jobs[1].id}`)).json();
      return job.stages.garment.status === "review" && job.stages.garment.keptBackground && job;
    });
    assert.equal(kept.stages.garment.attempts, 2);
    assert.equal((await post(`/api/import/jobs/${jobs[1].id}/stages/garment/approve`)).status, 200);

    const library = await (await fetch(`${ctx.base}/api/import/wardrobe`)).json();
    assert.deepEqual(library.map((entry) => entry.name).sort(), ["Blue jeans", "Navy tee"]);
  });

  test("styles new outfits and drops ones that use missing pieces", async () => {
    const response = await post("/api/import/outfits/generate", { count: 2, notes: "weekend" });
    assert.equal(response.status, 201);
    const { outfits } = await response.json();
    assert.equal(outfits.length, 1);
    assert.equal(outfits[0].name, "Easy Navy");
    assert.deepEqual(outfits[0].occasion, ["casual"]);
    assert.equal(outfits[0].image, null);
    assert.match(claude.requests.at(-1).body.messages[0].content[0].text, /The owner asked for: weekend/);

    const stored = JSON.parse(await readFile(path.join(ctx.dataDir, "outfits.json"), "utf8"));
    assert.equal(stored.outfits.length, 1);
    assert.equal((await fetch(`${ctx.base}/api/import/outfits/${outfits[0].id}`, { method: "DELETE" })).status, 200);
    assert.deepEqual(await (await fetch(`${ctx.base}/api/import/outfits`)).json(), []);
  });

  test("the same combination is not styled twice", async () => {
    await post("/api/import/outfits/generate", { count: 1 });
    const again = await (await post("/api/import/outfits/generate", { count: 1 })).json();
    assert.deepEqual(again.outfits, []);
  });
});

test("asks for the Anthropic key before importing", async () => {
  const ctx = await startServer({});
  try {
    const config = await (await fetch(`${ctx.base}/api/import/config`)).json();
    assert.equal(config.ready, false);
    const response = await fetch(`${ctx.base}/api/import/jobs`, { method: "POST", body: JSON.stringify({ imageBase64: "AAAA" }) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /ANTHROPIC_API_KEY/);
  } finally {
    await ctx.close();
  }
});
