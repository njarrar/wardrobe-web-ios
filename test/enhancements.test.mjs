import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOutfitEdit,
  buildStylePrompt,
  canMakeOutfit,
  normalizeManualOutfit,
  normalizeStyledOutfits,
} from "../shared/core.mjs";
import { swapCandidates } from "../shared/make-outfit.mjs";
import { mergePlans } from "../shared/merge.mjs";
import { colorName, humanColorName } from "../shared/pairing.mjs";
import { closetInsights, normalizePlan, planDays } from "../shared/style.mjs";

test("one-piece closets can style outfits and pass full metadata to AI", () => {
  const abaya = {
    id: "import-abaya",
    name: "Black linen abaya",
    part: "upperbody",
    kind: "abaya",
    color: "#1b1b1b",
    seasons: ["spring", "summer"],
    warmth: 2,
    formality: "smart",
    pattern: "solid",
    tags: ["linen"],
  };
  const sandals = { id: "import-sandals", name: "Tan sandals", part: "shoes", color: "#c29b6c", tags: [] };
  assert.equal(canMakeOutfit([abaya]), true);
  assert.equal(canMakeOutfit([abaya, sandals]), true);

  const prompt = buildStylePrompt({ items: [abaya, sandals], count: 2 });
  assert.match(prompt, /"kind":"abaya"/);
  assert.match(prompt, /"warmth":2/);
  assert.match(prompt, /"formality":"smart"/);
  assert.match(prompt, /"pattern":"solid"/);

  const styled = normalizeStyledOutfits(
    { outfits: [{ name: "Breezy Abaya", occasion: ["everyday"], garmentIds: ["import-abaya", "import-sandals"], reason: "Light linen." }] },
    [abaya, sandals],
  );
  assert.equal(styled.length, 1);
  assert.deepEqual(styled[0].garmentIds, ["import-abaya", "import-sandals"]);

  const manual = normalizeManualOutfit({ name: "Solo Abaya", garmentIds: ["import-abaya"] }, [abaya]);
  assert.deepEqual(manual.garmentIds, ["import-abaya"]);
});

test("applyOutfitEdit supports explicit single-piece swap without allowing raw garmentIds overwrite", () => {
  const items = [
    { id: "import-top", name: "White tee", part: "upperbody" },
    { id: "import-jeans", name: "Blue jeans", part: "lowerbody" },
    { id: "import-chinos", name: "Beige chinos", part: "lowerbody" },
  ];
  const outfit = { id: "o1", name: "Casual", garmentIds: ["import-top", "import-jeans"], occasion: [], reason: "" };

  const ignored = applyOutfitEdit(outfit, { name: "Renamed", garmentIds: ["import-top"] }, items);
  assert.deepEqual(ignored.garmentIds, ["import-top", "import-jeans"]);

  const swapped = applyOutfitEdit(outfit, { swap: { from: "import-jeans", to: "import-chinos" } }, items);
  assert.deepEqual(swapped.garmentIds, ["import-top", "import-chinos"]);

  assert.throws(() => applyOutfitEdit(outfit, { swap: { from: "import-jeans", to: "import-missing" } }, items), /valid piece/);
});

test("mergePlans preserves occasions and lockedDays across iCloud conflicts", () => {
  const older = {
    days: { "2026-11-20": "o1", "2026-11-21": "o2" },
    occasions: { "2026-11-20": "work", "2026-11-21": "dinner" },
    lockedDays: ["2026-11-20"],
    trips: [],
    updatedAt: "2026-11-19T10:00:00.000Z",
  };
  const newer = {
    days: { "2026-11-20": "o3", "2026-11-22": "o4" },
    occasions: { "2026-11-20": "formal", "2026-11-22": "casual" },
    lockedDays: ["2026-11-22"],
    trips: [],
    updatedAt: "2026-11-19T11:00:00.000Z",
  };
  const merged = mergePlans([older, newer]);
  assert.equal(merged.days["2026-11-20"], "o3");
  assert.equal(merged.days["2026-11-21"], "o2");
  assert.equal(merged.occasions["2026-11-20"], "formal");
  assert.equal(merged.occasions["2026-11-21"], "dinner");
  assert.equal(merged.occasions["2026-11-22"], "casual");
  assert.deepEqual(merged.lockedDays, ["2026-11-20", "2026-11-22"]);
});

test("planDays updates previousTop on kept days and normalizePlan cleans lockedDays", () => {
  const items = [
    { id: "t1", name: "White tee", part: "upperbody", color: "#f5f5f5" },
    { id: "t2", name: "Navy shirt", part: "upperbody", color: "#1d2d44" },
    { id: "b1", name: "Jeans", part: "lowerbody", color: "#3b5998" },
    { id: "b2", name: "Chinos", part: "lowerbody", color: "#cbbba0" },
  ];
  const outfits = [
    { id: "o1", name: "Tee + Jeans", garmentIds: ["t1", "b1"] },
    { id: "o2", name: "Tee + Chinos", garmentIds: ["t1", "b2"] },
    { id: "o3", name: "Navy + Chinos", garmentIds: ["t2", "b2"] },
  ];
  const days = planDays({
    outfits,
    items,
    start: "2026-11-20",
    length: 2,
    settings: { restDays: 1, pieceRest: 0 },
    keep: { "2026-11-20": "o1" },
  });
  assert.equal(days["2026-11-20"], "o1");
  assert.equal(days["2026-11-21"], "o3", "day after a kept day should avoid repeating its top");

  const cleaned = normalizePlan({
    days: { "2026-11-20": "o1" },
    lockedDays: ["2026-11-20", "2026-11-25", "not-a-day"],
  });
  assert.deepEqual(cleaned.lockedDays, ["2026-11-20"]);
});

test("humanColorName names neutrals and chromatic hues cleanly", () => {
  assert.equal(humanColorName("#141414"), "Black");
  assert.equal(humanColorName("#ffffff"), "White");
  assert.equal(humanColorName("#1c2b4a"), "Navy");
  assert.equal(humanColorName("#c83232"), "Red");
  assert.equal(humanColorName("#3068c8"), "Blue");
  assert.equal(colorName("#c83232"), "red");
});

test("swapCandidates ranks same-category replacements and separates one-pieces from tops", () => {
  const tee = { id: "t1", name: "White tee", part: "upperbody", color: "#ffffff", kind: "tee" };
  const shirt = { id: "t2", name: "Navy shirt", part: "upperbody", color: "#1d2d44", kind: "shirt" };
  const dress = { id: "d1", name: "Black dress", part: "upperbody", color: "#151515", kind: "dress" };
  const jeans = { id: "b1", name: "Blue jeans", part: "lowerbody", color: "#3b5998", kind: "jeans" };
  const results = swapCandidates(tee, [tee, jeans], [tee, shirt, dress, jeans], { today: "2026-11-20" });
  assert.deepEqual(results.map((item) => item.id), ["t2"]);
});

test("closetInsights computes value, cost per wear, utilization, heroes and needsLove", () => {
  const items = [
    { id: "a", name: "White tee", part: "upperbody", price: 30, wornDates: ["2026-11-01", "2026-11-10", "2026-11-15"] },
    { id: "b", name: "Wool coat", part: "wholebody_up", price: 200, wornDates: ["2026-01-05"] },
    { id: "c", name: "New loafers", part: "shoes", price: 100, wornDates: [], addedAt: "2026-08-01T00:00:00Z" },
  ];
  const stats = closetInsights(items, { today: "2026-11-19", days: 60 });
  assert.equal(stats.totalPieces, 3);
  assert.equal(stats.totalWears, 4);
  assert.equal(stats.totalValue, 330);
  assert.equal(stats.pricedCount, 3);
  assert.equal(stats.wornRecentlyCount, 1);
  assert.equal(stats.utilizationPct, 33);
  assert.equal(stats.mostWorn[0].item.id, "a");
  assert.equal(stats.bestValue[0].item.id, "a");
  assert.equal(stats.needsLove[0].item.id, "c");
});

test("a swap must put in the same kind of piece, and drops an old outfit picture", async () => {
  const { applyOutfitEdit } = await import("../shared/core.mjs");
  const closet = [
    { id: "top-1", part: "upperbody", name: "Tee" },
    { id: "top-2", part: "upperbody", name: "Shirt" },
    { id: "bottom-1", part: "lowerbody", name: "Jeans" },
    { id: "shoes-1", part: "shoes", name: "Sneakers" },
  ];
  const outfit = { id: "o1", garmentIds: ["top-1", "bottom-1"], image: "outfit-images/o1.png" };
  assert.throws(() => applyOutfitEdit(outfit, { swap: { from: "top-1", to: "shoes-1" } }, closet), /valid piece/);
  const next = applyOutfitEdit(outfit, { swap: { from: "top-1", to: "top-2" } }, closet);
  assert.deepEqual(next.garmentIds, ["top-2", "bottom-1"]);
  assert.equal(next.image, null);
});
