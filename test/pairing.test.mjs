import assert from "node:assert/strict";
import { test } from "node:test";
import { colorName, goesWith, isPatterned, pairingNote } from "../shared/pairing.mjs";
import { normalizePlan, occasionFit, planDays, wornByDay } from "../shared/style.mjs";
import { ANALYZE_SCHEMA, normalizeItemEdit, sortFields } from "../shared/core.mjs";
import { makeOutfit } from "../shared/make-outfit.mjs";

const piece = (id, part, color, more = {}) => ({ id, part, color, name: id, tags: [], addedAt: "2026-06-01T00:00:00Z", ...more });

test("names a color, and leaves neutrals unnamed", () => {
  assert.equal(colorName("#2f5fd0"), "blue");
  assert.equal(colorName("#d03030"), "red");
  assert.equal(colorName("#5f9b3a"), "green");
  assert.equal(colorName("#111111"), "");
});

test("the pairing note fits the piece", () => {
  assert.match(pairingNote(piece("a", "upperbody", "#f3f1ec"))[0][0], /neutral/);
  const [text, vars] = pairingNote(piece("b", "upperbody", "#2f5fd0"))[0];
  assert.match(text, /neutrals/);
  assert.equal(vars.b, "orange", "blue sits across from orange");
  assert.notEqual(vars.a, "blue");
  const striped = pairingNote(piece("c", "upperbody", "#2f5fd0", { pattern: "striped", formality: "formal" })).map(([line]) => line);
  assert.ok(striped.some((line) => /pattern/.test(line)) && striped.some((line) => /Dressy/.test(line)));
  assert.equal(isPatterned({ pattern: "solid" }), false);
  assert.equal(isPatterned({ pattern: "textured" }), false);
});

test("goes well with: other categories, plain next to patterned, same dress level", () => {
  const shirt = piece("striped-shirt", "upperbody", "#2f5fd0", { pattern: "striped", formality: "smart" });
  const closet = [
    shirt,
    piece("other-top", "upperbody", "#111111"),
    piece("plain-chinos", "lowerbody", "#c8b48a", { pattern: "solid", formality: "smart" }),
    piece("checked-trousers", "lowerbody", "#c8b48a", { pattern: "checked", formality: "smart" }),
    piece("gym-shorts", "lowerbody", "#30d030", { formality: "casual" }),
    piece("loafers", "shoes", "#7a5134", { formality: "smart" }),
    piece("coat", "wholebody_up", "#111111"),
  ];
  const partners = goesWith(shirt, closet, { today: "2026-11-18" }).map((entry) => entry.id);
  assert.ok(!partners.includes("other-top") && !partners.includes("striped-shirt"));
  assert.equal(partners.filter((id) => ["plain-chinos", "checked-trousers", "gym-shorts"].includes(id)).length, 2, "two per category at most");
  assert.ok(partners.indexOf("plain-chinos") < partners.indexOf("checked-trousers"));
  assert.ok(!partners.includes("gym-shorts"));
  const abaya = piece("abaya", "upperbody", "#111111", { kind: "abaya" });
  assert.ok(goesWith(abaya, [...closet, abaya]).every((entry) => entry.part !== "lowerbody"));
});

test("pattern is a field the AI fills and the person can change", () => {
  assert.ok(ANALYZE_SCHEMA.properties.items.items.required.includes("pattern"));
  assert.deepEqual(sortFields({ pattern: "striped" }), { pattern: "striped" });
  assert.deepEqual(sortFields({ pattern: "zigzag" }), {});
  const item = piece("a", "upperbody", "#111111");
  assert.equal(normalizeItemEdit(item, { pattern: "floral" }).pattern, "floral");
  assert.equal("pattern" in normalizeItemEdit({ ...item, pattern: "floral" }, { pattern: null }), false);
  assert.throws(() => normalizeItemEdit(item, { pattern: "zigzag" }), /pattern/);
});

test("a day's occasion steers the plan and is kept with it", () => {
  const items = [
    piece("tee", "upperbody", "#f3f1ec", { formality: "casual" }), piece("jeans", "lowerbody", "#34528f", { formality: "casual" }),
    piece("shirt", "upperbody", "#f3f1ec", { formality: "smart" }), piece("chinos", "lowerbody", "#c8b48a", { formality: "smart" }),
    piece("suit-jacket", "wholebody_up", "#111111", { formality: "formal" }), piece("suit-trousers", "lowerbody", "#111111", { formality: "formal" }), piece("dress-shirt", "upperbody", "#ffffff", { formality: "formal" }),
  ];
  const outfits = [
    { id: "relaxed", garmentIds: ["tee", "jeans"], occasion: ["weekend"] },
    { id: "office", garmentIds: ["shirt", "chinos"], occasion: [] },
    { id: "suit", garmentIds: ["dress-shirt", "suit-trousers", "suit-jacket"], occasion: [] },
  ];
  const byId = new Map(items.map((item) => [item.id, item]));
  const fit = (id, occasion) => occasionFit(outfits.find((outfit) => outfit.id === id), outfits.find((outfit) => outfit.id === id).garmentIds.map((key) => byId.get(key)), occasion);
  assert.equal(fit("relaxed", "casual"), 1);
  assert.equal(fit("office", "work"), 1);
  assert.equal(fit("suit", "formal"), 1);
  assert.equal(fit("relaxed", "formal"), 0);
  const occasions = { "2026-11-21": "formal", "2026-11-22": "casual", "2026-11-23": "work" };
  const days = planDays({ outfits, items, start: "2026-11-21", length: 3, occasions, settings: { restDays: 0, workDays: [] } });
  assert.deepEqual(days, { "2026-11-21": "suit", "2026-11-22": "relaxed", "2026-11-23": "office" });
  const saved = normalizePlan({ days, occasions: { ...occasions, "2026-11-24": "brunch", nonsense: "work" } });
  assert.deepEqual(saved.occasions, occasions);
  assert.deepEqual(normalizePlan({}).occasions, {});
});

test("lists what was worn on each day", () => {
  const worn = wornByDay([{ id: "o1", wornDates: ["2026-11-10"] }], [{ id: "p1", wornDates: ["2026-11-10", "2026-11-12"] }]);
  assert.deepEqual(worn["2026-11-10"], { outfitIds: ["o1"], pieceIds: ["p1"] });
  assert.deepEqual(worn["2026-11-12"], { outfitIds: [], pieceIds: ["p1"] });
});

test("the outfit maker leans to the day's dress level", () => {
  const items = [
    piece("tee", "upperbody", "#f3f1ec", { formality: "casual" }), piece("jeans", "lowerbody", "#55585e", { formality: "casual" }),
    piece("dress-shirt", "upperbody", "#f3f1ec", { formality: "formal" }), piece("suit-trousers", "lowerbody", "#55585e", { formality: "formal" }),
  ];
  assert.deepEqual(makeOutfit({ items, today: "2026-11-18", dress: "formal" }).garmentIds.sort(), ["dress-shirt", "suit-trousers"]);
  assert.deepEqual(makeOutfit({ items, today: "2026-11-18", dress: "casual" }).garmentIds.sort(), ["jeans", "tee"]);
});
