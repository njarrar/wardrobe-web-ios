import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mergePlans, mergeRecords, mergeRemoved, stampChanges, trimRemoved } from "../shared/merge.mjs";
import { createLocalApi } from "../src/local/backend.js";
import { createMemoryStore } from "../src/local/store.js";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));

describe("joining two copies of a closet", () => {
  test("stamps new and changed records and lists removed ones", () => {
    const before = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    const after = [{ id: "a", name: "A" }, { id: "b", name: "B2" }, { id: "d", name: "D" }];
    const { list, removed } = stampChanges(before, after, "2026-11-18T10:00:00.000Z");
    assert.equal(list[0].updatedAt, undefined);
    assert.equal(list[1].updatedAt, "2026-11-18T10:00:00.000Z");
    assert.equal(list[2].updatedAt, "2026-11-18T10:00:00.000Z");
    assert.deepEqual(removed, ["c"]);
  });

  test("keeps pieces from both devices and the newer edit of each", () => {
    const phone = [{ id: "a", name: "Old", updatedAt: "2026-11-01T00:00:00Z" }, { id: "b", name: "Phone only", updatedAt: "2026-11-02T00:00:00Z" }];
    const tablet = [{ id: "a", name: "New", updatedAt: "2026-11-03T00:00:00Z" }, { id: "c", name: "Tablet only", updatedAt: "2026-11-02T00:00:00Z" }];
    const merged = mergeRecords([phone, tablet]);
    assert.deepEqual(merged.map((record) => record.id).sort(), ["a", "b", "c"]);
    assert.equal(merged.find((record) => record.id === "a").name, "New");
  });

  test("a removed piece stays removed, unless it was changed after", () => {
    const copy = [{ id: "a", updatedAt: "2026-11-01T00:00:00Z" }, { id: "b", updatedAt: "2026-11-05T00:00:00Z" }];
    const removed = mergeRemoved([{ a: "2026-11-02T00:00:00Z" }, { a: "2026-11-01T12:00:00Z", b: "2026-11-04T00:00:00Z" }]);
    assert.equal(removed.a, "2026-11-02T00:00:00Z");
    assert.deepEqual(mergeRecords([copy], removed).map((record) => record.id), ["b"]);
  });

  test("plans keep days from both copies, newest wins a clash", () => {
    const merged = mergePlans([
      { updatedAt: "2026-11-02T00:00:00Z", days: { "2026-11-20": "x", "2026-11-21": "new" }, trips: [{ id: "t2" }], settings: { restDays: 3 } },
      { updatedAt: "2026-11-01T00:00:00Z", days: { "2026-11-19": "y", "2026-11-21": "old" }, trips: [{ id: "t1" }], settings: { restDays: 7 } },
    ]);
    assert.deepEqual(merged.days, { "2026-11-19": "y", "2026-11-20": "x", "2026-11-21": "new" });
    assert.equal(merged.trips.length, 2);
    assert.equal(merged.settings.restDays, 3);
  });

  test("old removal notes are dropped", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    assert.deepEqual(Object.keys(trimRemoved({ old: "2026-01-01T00:00:00Z", fresh: "2026-11-01T00:00:00Z" }, now)), ["fresh"]);
  });

  test("the closet joins an iCloud clash instead of dropping a piece", async () => {
    const store = createMemoryStore({ kind: "icloud" });
    const api = createLocalApi({ store });
    const call = async (path, method = "GET", body) => {
      const response = await api.handle(path, { method, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, value: await response.json() };
    };
    await store.writeJson("items.json", [{ id: "import-a", name: "Phone piece", updatedAt: "2026-11-02T00:00:00Z" }, { id: "import-gone", name: "Removed on tablet", updatedAt: "2026-11-01T00:00:00Z" }]);
    store.clashes.set("items.json", [bytes([{ id: "import-b", name: "Tablet piece", updatedAt: "2026-11-03T00:00:00Z" }])]);
    store.clashes.set("removed.json", [bytes({ items: { "import-gone": "2026-11-02T00:00:00Z" }, outfits: {} })]);
    const listed = (await call("/api/import/wardrobe")).value;
    assert.deepEqual(listed.map((item) => item.name).sort(), ["Phone piece", "Tablet piece"]);
    assert.equal(store.clashes.size, 0);
    assert.equal((await store.readJson("items.json", [])).length, 2);

    // A delete leaves a note, so a stale copy cannot bring the piece back.
    assert.equal((await call("/api/import/wardrobe/import-a", "DELETE")).status, 200);
    assert.ok((await store.readJson("removed.json", {})).items["import-a"]);
    store.clashes.set("items.json", [bytes([{ id: "import-a", name: "Phone piece", updatedAt: "2026-11-02T00:00:00Z" }])]);
    assert.deepEqual((await call("/api/import/wardrobe")).value.map((item) => item.id), ["import-b"]);
  });
});
