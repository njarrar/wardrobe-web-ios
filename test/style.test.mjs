import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, colorHarmony, costPerWear, editWornDates, forgottenPieces, idleLabel, isNeutral,
  normalizePlan, packingList, planDays, planRepeats, todaysOutfit, weatherFit,
} from "../shared/style.mjs";
import { buildStylePrompt, normalizeItemEdit, applyOutfitEdit, styleOptions } from "../shared/core.mjs";

test("neutrals are left off the wheel", () => {
  for (const hex of ["#111111", "#f3f1ec", "#9a9893", "#c8b48a", "#7a5134", "#1f3566"]) assert.equal(isNeutral(hex), true, hex);
  for (const hex of ["#c2562b", "#3a6ee8", "#5f9b3a", "#d64aa6"]) assert.equal(isNeutral(hex), false, hex);
});

test("reads the color wheel rule of an outfit", () => {
  assert.equal(colorHarmony(["#111111", "#f3f1ec", "#9a9893"]).rule, "tonal");
  assert.equal(colorHarmony(["#1f3566", "#c8b48a", "#c2562b"]).rule, "accent");
  assert.equal(colorHarmony(["#2f6fd0", "#2fa7b0", "#f3f1ec"]).rule, "neighbors");
  assert.equal(colorHarmony(["#2f5fd0", "#d0752f", "#111111"]).rule, "opposites");
  assert.equal(colorHarmony(["#d03030", "#30d030", "#3030d0"]).rule, "three-way");
  const clash = colorHarmony(["#d03030", "#30d0a0", "#e0d030", "#a030d0"]);
  assert.equal(clash.rule, "free");
  assert.ok(clash.score < colorHarmony(["#2f5fd0", "#d0752f"]).score);
});

test("keeps worn dates sorted, unique and valid", () => {
  assert.deepEqual(editWornDates(["2026-11-02"], { wear: "2026-11-01" }), ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(editWornDates(["2026-11-01"], { wear: "2026-11-01" }), ["2026-11-01"]);
  assert.deepEqual(editWornDates(["2026-11-01", "2026-11-02"], { unwear: "2026-11-01" }), ["2026-11-02"]);
  assert.throws(() => editWornDates([], { wear: "2026-02-30" }), /date/);
});

test("item edits take a price and wear dates", () => {
  const record = { id: "import-a", color: "#112233", palette: [] };
  const next = normalizeItemEdit(record, { price: "79.999", wear: "2026-11-18" });
  assert.equal(next.price, 80);
  assert.deepEqual(next.wornDates, ["2026-11-18"]);
  assert.equal(normalizeItemEdit(next, { price: null }).price, null);
  assert.throws(() => normalizeItemEdit(record, { price: "lots" }), /price/);
  assert.deepEqual(applyOutfitEdit({ id: "o", wornDates: ["2026-11-18"] }, { unwear: "2026-11-18" }).wornDates, []);
  assert.equal(costPerWear({ price: 80, wornDates: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"] }), 20);
  assert.equal(costPerWear({ price: null }), null);
});

test("finds pieces not worn in a while", () => {
  const items = [
    { id: "a", wornDates: ["2026-11-10"] },
    { id: "b", wornDates: ["2025-02-01"] },
    { id: "c", addedAt: "2026-06-01T00:00:00.000Z" },
    { id: "d", addedAt: "2026-11-15T00:00:00.000Z" },
  ];
  assert.deepEqual(forgottenPieces(items, { today: "2026-11-18" }).map((item) => item.id), ["b", "c"]);
  assert.equal(idleLabel(items[2], "2026-11-18"), "Never worn");
  assert.equal(idleLabel(items[1], "2026-11-18"), "Since Feb 2025");
  assert.equal(idleLabel(items[0], "2026-11-18"), "8 days ago");
});

const closet = [
  { id: "t1", part: "upperbody", color: "#2f4a7a" }, { id: "t2", part: "upperbody", color: "#f3f1ec" },
  { id: "t3", part: "upperbody", color: "#9a9893" }, { id: "b1", part: "lowerbody", color: "#c8b48a" },
  { id: "b2", part: "lowerbody", color: "#111111" }, { id: "j1", part: "wholebody_up", color: "#5f6b3f", tags: ["wool"] },
];
const looks = [
  { id: "o1", garmentIds: ["t1", "b1"], occasion: ["weekend"] },
  { id: "o2", garmentIds: ["t2", "b2"], occasion: ["work"] },
  { id: "o3", garmentIds: ["t3", "b1", "j1"], occasion: ["work"] },
  { id: "o4", garmentIds: ["t1", "b2"], occasion: ["dinner"] },
  { id: "o5", garmentIds: ["t2", "b1"], occasion: ["work"] },
  { id: "o6", garmentIds: ["t3", "b2"], occasion: ["coffee"] },
  { id: "o7", garmentIds: ["t1", "b1", "j1"], occasion: ["work"] },
  { id: "o8", garmentIds: ["t2", "b2", "j1"], occasion: ["evening"] },
];

test("today's outfit rests worn outfits and shuffles", () => {
  const outfits = looks.map((look) => (look.id === "o1" ? { ...look, wornDates: ["2026-11-17"] } : look));
  const first = todaysOutfit({ outfits, items: closet, today: "2026-11-18" });
  assert.notEqual(first.outfit.id, "o1");
  const picks = new Set([0, 1, 2, 3].map((shuffle) => todaysOutfit({ outfits, items: closet, today: "2026-11-18", shuffle }).outfit.id));
  assert.ok(picks.size > 1);
  const planned = todaysOutfit({ outfits, items: closet, today: "2026-11-18", plan: { days: { "2026-11-18": "o6" } } });
  assert.equal(planned.outfit.id, "o6");
  assert.equal(planned.planned, true);
});

test("plans a month with no outfit back inside a week", () => {
  const days = planDays({ outfits: looks, items: closet, start: "2026-12-01", length: 31 });
  assert.equal(Object.keys(days).length, 31);
  assert.deepEqual(planRepeats(days, 7), []);
  const sorted = Object.keys(days).sort();
  for (let i = 1; i < sorted.length; i += 1) {
    const top = (id) => looks.find((look) => look.id === id).garmentIds[0];
    assert.notEqual(top(days[sorted[i]]), top(days[sorted[i - 1]]), sorted[i]);
  }
  const kept = planDays({ outfits: looks, items: closet, start: "2026-12-01", length: 3, keep: { "2026-12-02": "o8" } });
  assert.equal(kept["2026-12-02"], "o8");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("packing list counts each piece over a trip", () => {
  const days = { "2026-12-01": "o1", "2026-12-02": "o4", "2026-12-05": "o2" };
  const list = packingList({ days, outfits: looks, items: closet, from: "2026-12-01", to: "2026-12-03" });
  assert.deepEqual(list.map(({ item, count }) => [item.id, count]), [["t1", 2], ["b1", 1], ["b2", 1]]);
});

test("cold days want a warm layer", () => {
  const coat = [closet[2], closet[3], closet[5]];
  const bare = [closet[0], closet[3]];
  assert.ok(weatherFit(coat, { temperature: 4 }) > weatherFit(bare, { temperature: 4 }));
  assert.ok(weatherFit(bare, { temperature: 24 }) > weatherFit(coat, { temperature: 24 }));
});

test("plans are cleaned before saving", () => {
  const plan = normalizePlan({ days: { "2026-12-01": "o1", "nope": "o2", "2026-12-02": "../x" }, settings: { workDays: [1, 9, 1], restDays: 99 }, trips: [{ name: "Cairo", from: "2026-12-10", to: "2026-12-12" }, { from: "2026-12-12", to: "2026-12-01" }] });
  assert.deepEqual(plan.days, { "2026-12-01": "o1" });
  assert.deepEqual(plan.settings.workDays, [1]);
  assert.equal(plan.settings.restDays, 7);
  assert.equal(plan.trips.length, 1);
});

test("style requests carry the color rule and forgotten pieces", () => {
  assert.deepEqual(styleOptions({ rule: "opposites", preferIds: ["import-a", "../bad", 3] }), { rule: "opposites", preferIds: ["import-a"] });
  assert.equal(styleOptions({ rule: "loud" }).rule, "");
  const prompt = buildStylePrompt({ items: [{ id: "import-a", name: "Scarf", part: "accessories_up", color: "#c2562b", tags: [] }], rule: "opposites", preferIds: ["import-a", "import-gone"] });
  assert.match(prompt, /opposite colors/);
  assert.match(prompt, /\["import-a"\]/);
});
