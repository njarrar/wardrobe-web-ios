import assert from "node:assert/strict";
import { test } from "node:test";
import { canMakeOutfit, makeOutfit, makeOutfits, outfitKey, outfitTitle } from "../shared/make-outfit.mjs";
import { applyOutfitEdit, normalizeManualOutfit } from "../shared/core.mjs";

const today = "2026-11-18";
const piece = (id, part, color, more = {}) => ({ id, part, color, name: id, tags: [], addedAt: "2026-06-01T00:00:00Z", ...more });
const closet = [
  piece("white-tee", "upperbody", "#f3f1ec", { warmth: 1, formality: "casual" }),
  piece("navy-shirt", "upperbody", "#1f3566", { warmth: 2, formality: "smart" }),
  piece("wool-sweater", "upperbody", "#9a9893", { warmth: 4, formality: "casual" }),
  piece("red-top", "upperbody", "#d03030", { warmth: 2, formality: "casual" }),
  piece("grey-jeans", "lowerbody", "#55585e", { warmth: 3, formality: "casual" }),
  piece("beige-chinos", "lowerbody", "#c8b48a", { warmth: 2, formality: "smart" }),
  piece("linen-shorts", "lowerbody", "#e9e2d0", { warmth: 1, formality: "casual" }),
  piece("black-coat", "wholebody_up", "#111111", { warmth: 5, formality: "smart" }),
  piece("white-sneakers", "shoes", "#f5f5f5", { warmth: 2, formality: "casual" }),
  piece("brown-boots", "shoes", "#7a5134", { warmth: 4, formality: "smart" }),
  piece("green-scarf", "accessories_up", "#30a050", { warmth: 4 }),
];
const parts = (outfit) => outfit.pieces.map((entry) => entry.part);

test("makes a top, a bottom and shoes, the same for the same day and seed", () => {
  const outfit = makeOutfit({ items: closet, today });
  assert.ok(parts(outfit).includes("upperbody") && parts(outfit).includes("lowerbody") && parts(outfit).includes("shoes"));
  assert.equal(new Set(parts(outfit)).size, parts(outfit).length, "one piece per slot");
  assert.deepEqual(makeOutfit({ items: closet, today }).garmentIds, outfit.garmentIds);
  assert.ok(outfit.why.length >= 1);
});

test("a new seed gives another mix", () => {
  const keys = new Set(Array.from({ length: 8 }, (_, seed) => makeOutfit({ items: closet, today, seed }).key));
  assert.ok(keys.size >= 3, `only ${keys.size} mixes in 8 shuffles`);
});

test("locked pieces stay through every shuffle", () => {
  for (let seed = 0; seed < 10; seed += 1) {
    const outfit = makeOutfit({ items: closet, today, seed, locked: ["red-top", "brown-boots"] });
    assert.ok(outfit.garmentIds.includes("red-top") && outfit.garmentIds.includes("brown-boots"));
  }
});

test("a mix marked Not me does not come back", () => {
  const rejected = [];
  for (let round = 0; round < 6; round += 1) {
    const outfit = makeOutfit({ items: closet, today, rejected });
    assert.ok(!rejected.includes(outfit.key));
    rejected.push(outfit.key);
  }
});

test("dresses for the weather", () => {
  const cold = makeOutfit({ items: closet, today, weather: { temperature: 3, rain: false } });
  assert.ok(cold.garmentIds.includes("black-coat"), "a coat when it is cold");
  assert.ok(!cold.garmentIds.includes("linen-shorts"));
  const hot = makeOutfit({ items: closet, today: "2026-07-18", weather: { temperature: 34, rain: false } });
  assert.ok(!hot.garmentIds.includes("black-coat") && !hot.garmentIds.includes("wool-sweater"));
  assert.ok(hot.why.some(([text]) => text.includes("{n}°")));
});

test("a piece worn yesterday rests when others can stand in", () => {
  const items = closet.map((item) => (item.id === "grey-jeans" || item.id === "white-tee" ? { ...item, wornDates: ["2026-11-17"] } : item));
  for (let seed = 0; seed < 8; seed += 1) {
    const outfit = makeOutfit({ items, today, seed });
    assert.ok(!outfit.garmentIds.includes("grey-jeans") && !outfit.garmentIds.includes("white-tee"));
  }
  const only = [closet[0], { ...closet[4], wornDates: ["2026-11-17"] }];
  assert.deepEqual(makeOutfit({ items: only, today }).garmentIds.sort(), ["grey-jeans", "white-tee"]);
});

test("a dress or an abaya needs no bottom", () => {
  const items = [piece("black-abaya", "upperbody", "#111111", { kind: "abaya" }), piece("sandals", "shoes", "#c8b48a")];
  assert.equal(canMakeOutfit(items), true);
  assert.deepEqual(makeOutfit({ items, today }).garmentIds, ["black-abaya", "sandals"]);
  assert.equal(canMakeOutfit([closet[0]]), false);
  assert.equal(makeOutfit({ items: [closet[0]], today }), null);
});

test("makes several outfits, none saved before and none twice", () => {
  const saved = [{ id: "a", garmentIds: makeOutfit({ items: closet, today }).garmentIds }];
  const made = makeOutfits({ items: closet, today, count: 5, outfits: saved });
  assert.equal(made.length, 5);
  const keys = made.map((outfit) => outfit.key);
  assert.equal(new Set(keys).size, 5);
  assert.ok(!keys.includes(outfitKey(saved[0].garmentIds)));
  assert.equal(outfitTitle(made[0].pieces).includes(" + "), true);
});

test("an outfit can be a favorite", () => {
  const saved = normalizeManualOutfit({ garmentIds: ["white-tee", "grey-jeans"], favorite: true, madeOnPhone: true }, closet);
  assert.equal(saved.favorite, true);
  assert.equal(saved.madeOnPhone, true);
  assert.equal(applyOutfitEdit(saved, { favorite: false }).favorite, false);
  assert.equal(normalizeManualOutfit({ garmentIds: ["white-tee", "grey-jeans"] }, closet).favorite, undefined);
});
