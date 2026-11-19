// The serverless closet (iCloud mode) answers the same API from a store.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { createLocalApi, storePath } from "../src/local/backend.js";
import { createMemoryStore } from "../src/local/store.js";
import { startMockAi } from "./mock-ai.mjs";

const dataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out");
}

describe("local closet", () => {
  let claude;
  let store;
  let api;
  let aiCalls = 0;
  const call = async (path, method = "GET", body) => {
    const response = await api.handle(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
    return { status: response.status, value: await response.json().catch(() => null) };
  };

  before(async () => {
    claude = await startMockAi();
    store = createMemoryStore({ kind: "icloud" });
    const env = (name) => ({ ANTHROPIC_BASE_URL: claude.url }[name] || "");
    // Stand-in for the phone's Vision cutout: white turns clear.
    const cutout = async (bytes) => {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let index = 0; index < data.length; index += 4) if (data[index] > 240 && data[index + 1] > 240 && data[index + 2] > 240) data[index + 3] = 0;
      return new Uint8Array(await sharp(data, { raw: info }).png().toBuffer());
    };
    const aiFetch = (...args) => { aiCalls += 1; return fetch(...args); };
    api = createLocalApi({ store, env, cutout, aiFetch, version: "3.0.0" });
  });
  after(() => claude.close());

  test("says it is local and needs no token", async () => {
    const health = await call("/api/health");
    assert.equal(health.value.local, true);
    assert.equal(health.value.protected, false);
    const config = await call("/api/import/config");
    assert.equal(config.value.storage, "icloud");
    assert.equal(config.value.ready, false);
  });

  test("keeps the AI key in the secret store, never in a file", async () => {
    const saved = await call("/api/import/settings/ai", "PUT", { provider: "claude", keys: { claude: "sk-ant-local-test-1234" } });
    assert.equal(saved.status, 200);
    assert.equal(saved.value.ready, true);
    assert.ok(JSON.parse(await store.getSecret("ai-settings")).keys.claude);
    for (const bytes of store.files.values()) assert.ok(!new TextDecoder().decode(bytes).includes("sk-ant-local"));
  });

  test("imports a photo: finds, cuts out on the device and adds the pieces", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#fff"/><rect x="80" y="60" width="240" height="200" fill="#1f2a44"/><rect x="100" y="320" width="200" height="260" fill="#3b5b8c"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const created = await call("/api/import/jobs", "POST", { imageDataUrl: dataUrl(png) });
    assert.equal(created.status, 202);
    assert.ok(aiCalls > 0, "the AI is called from the device");
    const [first, second] = created.value.jobs;
    assert.equal(first.metadata.name, "Navy tee");
    for (const job of created.value.jobs) assert.equal((await call(`/api/import/jobs/${job.id}/stages/crop/approve`, "POST")).status, 200);
    const ready = await waitFor(async () => { const job = (await call(`/api/import/jobs/${first.id}`)).value; return job.stages.garment.status === "review" && job; });
    assert.equal(ready.stages.garment.keptBackground, false);
    const picture = await store.readBytes(storePath(ready.stages.garment.assetUrl));
    const { data } = await sharp(Buffer.from(picture)).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "corner should be clear");
    const approved = await call(`/api/import/jobs/${first.id}/stages/garment/approve`, "POST");
    assert.equal(approved.value.item.name, "Navy tee");
    await waitFor(async () => (await call(`/api/import/jobs/${second.id}`)).value.stages.garment.status === "review");
    assert.equal((await call(`/api/import/jobs/${second.id}/stages/garment/reject`, "POST")).status, 200);
    const library = (await call("/api/import/wardrobe")).value;
    assert.deepEqual(library.map((item) => item.name), ["Navy tee"]);
    assert.ok(await store.readBytes(storePath(library[0].image)));
    assert.deepEqual((await call("/api/import/jobs")).value, []);
  });

  test("edits, wears, swaps the picture and deletes a piece", async () => {
    const png = await sharp({ create: { width: 30, height: 30, channels: 4, background: "#334455" } }).png().toBuffer();
    const piece = (await call("/api/import/wardrobe", "POST", { imageDataUrl: dataUrl(png), name: "Grey chinos", part: "lowerbody", color: "#888888" })).value;
    const edited = await call(`/api/import/wardrobe/${piece.id}`, "PATCH", { name: "Stone chinos", wear: "2026-11-18" });
    assert.equal(edited.value.name, "Stone chinos");
    assert.deepEqual(edited.value.wornDates, ["2026-11-18"]);
    const swapped = (await call(`/api/import/wardrobe/${piece.id}/image`, "PUT", { imageDataUrl: dataUrl(png) })).value;
    assert.notEqual(swapped.image, piece.image);
    assert.equal(await store.readBytes(storePath(piece.image)), null);
    assert.equal((await call(`/api/import/wardrobe/${piece.id}`, "DELETE")).status, 200);
    assert.equal(await store.readBytes(storePath(swapped.image)), null);
  });

  test("styles outfits with the AI, saves a plan and sorts pieces", async () => {
    const png = await sharp({ create: { width: 30, height: 30, channels: 4, background: "#3b5b8c" } }).png().toBuffer();
    await call("/api/import/wardrobe", "POST", { imageDataUrl: dataUrl(png), name: "Blue jeans", part: "lowerbody", color: "#3b5b8c" });
    const styled = await call("/api/import/outfits/generate", "POST", { count: 2 });
    assert.equal(styled.status, 201);
    assert.ok(styled.value.outfits.length >= 1);
    assert.ok(styled.value.outfits.every((outfit) => outfit.garmentIds.length >= 2));
    const outfits = (await call("/api/import/outfits")).value;
    const day = "2026-11-20";
    const plan = await call("/api/import/plan", "PUT", { days: { [day]: outfits[0].id } });
    assert.equal(plan.value.days[day], outfits[0].id);
    assert.equal((await call("/api/import/plan")).value.days[day], outfits[0].id);
    const sorted = await call("/api/import/wardrobe/sort", "POST", { all: true });
    assert.equal(sorted.status, 200);
    assert.equal((await call(`/api/import/outfits/${outfits[0].id}`, "DELETE")).status, 200);
  });

  test("answers 404 for unknown routes and 400 for bad bodies", async () => {
    assert.equal((await call("/api/import/nothing")).status, 404);
    const bad = await api.handle("/api/import/plan", { method: "PUT", body: "{not json" });
    assert.equal(bad.status, 400);
  });
});
