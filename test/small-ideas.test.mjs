import assert from "node:assert/strict";
import { test } from "node:test";
import { makeOutfit } from "../shared/make-outfit.mjs";
import { isModestWear, tileNote } from "../shared/pairing.mjs";
import { feelsLike, isWetDay, normalizePlan, planDays, weatherFit } from "../shared/style.mjs";
import { STARTER_PIECES } from "../shared/starter.mjs";
import { shapeSvg } from "../shared/shapes.mjs";
import { ANALYZE_PROMPT } from "../shared/core.mjs";
import { forecastUrl, parseForecast } from "../src/weather.js";

const today = "2026-11-18";
const piece = (id, part, color, more = {}) => ({ id, part, color, name: id, tags: [], addedAt: "2026-06-01T00:00:00Z", ...more });

test("modest wear can be added as basics and is known to the AI", () => {
  for (const kind of ["abaya", "thobe", "hijab", "shemagh", "bisht"]) {
    const starter = STARTER_PIECES.find((entry) => entry.kind === kind);
    assert.ok(starter, kind);
    assert.match(shapeSvg(starter.shape, starter.color), /<path/);
    assert.ok(ANALYZE_PROMPT.includes(kind));
    assert.equal(isModestWear(starter), true);
  }
  assert.equal(isModestWear(piece("jeans", "lowerbody", "#34528f")), false);
});

test("an abaya goes out with a hijab, a thobe with a shemagh", () => {
  const closet = [
    piece("abaya", "upperbody", "#111111", { kind: "abaya" }), piece("hijab", "accessories_up", "#c9b996", { kind: "hijab" }),
    piece("thobe", "upperbody", "#f3f1ec", { kind: "thobe" }), piece("shemagh", "accessories_up", "#6e2530", { kind: "shemagh" }),
    piece("sandals", "shoes", "#6e4428"), piece("watch", "accessories_up", "#9a9893"),
  ];
  for (let seed = 0; seed < 8; seed += 1) {
    const ids = makeOutfit({ items: closet, today, seed }).garmentIds;
    if (ids.includes("abaya")) assert.ok(ids.includes("hijab") && !ids.includes("shemagh"), ids.join());
    if (ids.includes("thobe")) assert.ok(ids.includes("shemagh") && !ids.includes("hijab"), ids.join());
  }
  const tee = [piece("tee", "upperbody", "#f3f1ec"), piece("skirt", "lowerbody", "#34528f"), closet[1]];
  assert.ok(makeOutfit({ items: tee, today }).garmentIds.includes("hijab"), "a hijab goes with every outfit");
});

test("the piece rest rule can be set, in the maker and in the plan", () => {
  const items = [
    piece("tee-a", "upperbody", "#f3f1ec", { wornDates: ["2026-11-14"] }), piece("tee-b", "upperbody", "#f3f1ec", { wornDates: ["2026-06-02"] }),
    piece("jeans", "lowerbody", "#34528f"),
  ];
  assert.ok(makeOutfit({ items, today, rest: 5 }).garmentIds.includes("tee-b"));
  assert.equal(normalizePlan({}).settings.pieceRest, 2);
  assert.equal(normalizePlan({ settings: { pieceRest: 5 } }).settings.pieceRest, 5);
  assert.equal(normalizePlan({ settings: { pieceRest: 99 } }).settings.pieceRest, 2);

  // Two outfits share the jeans, a third does not: with a rest of 1 day the
  // jeans never show two days running.
  const closet = [piece("t1", "upperbody", "#f3f1ec"), piece("t2", "upperbody", "#111111"), piece("t3", "upperbody", "#9a9893"), piece("jeans", "lowerbody", "#34528f"), piece("chinos", "lowerbody", "#c8b48a")];
  const outfits = [{ id: "a", garmentIds: ["t1", "jeans"] }, { id: "b", garmentIds: ["t2", "jeans"] }, { id: "c", garmentIds: ["t3", "chinos"] }];
  const days = planDays({ outfits, items: closet, start: today, length: 4, settings: { restDays: 0, pieceRest: 1, workDays: [] } });
  const order = Object.keys(days).sort().map((day) => days[day]);
  for (let i = 1; i < order.length; i += 1) assert.ok(!(order[i] !== "c" && order[i - 1] !== "c"), order.join());
});

test("wind and rain amount come with the forecast and change the pick", () => {
  assert.match(forecastUrl(25.2, 55.3), /precipitation_sum/);
  assert.match(forecastUrl(25.2, 55.3), /wind_speed_10m_max/);
  const forecast = parseForecast({ daily: { time: ["2026-11-18"], temperature_2m_max: [18], temperature_2m_min: [10], weather_code: [61], precipitation_probability_max: [80], precipitation_sum: [7.25], wind_speed_10m_max: [38.4] } });
  assert.deepEqual({ wind: forecast["2026-11-18"].wind, rainMm: forecast["2026-11-18"].rainMm, rain: forecast["2026-11-18"].rain }, { wind: 38, rainMm: 7.3, rain: true });
  assert.equal(feelsLike({ temperature: 15, wind: 35 }), 13);
  assert.equal(feelsLike({ temperature: 15, wind: 50 }), 11);
  assert.equal(feelsLike({ temperature: 15 }), 15);
  assert.equal(isWetDay({ rain: true, rainMm: 7 }), true);
  assert.equal(isWetDay({ rain: true, rainMm: 1 }), false);
  const top = piece("shirt", "upperbody", "#f3f1ec", { warmth: 3 });
  const jeans = piece("jeans", "lowerbody", "#34528f", { warmth: 3 });
  const jacket = piece("jacket", "wholebody_up", "#111111", { warmth: 3 });
  const sandals = piece("sandals", "shoes", "#6e4428", { kind: "sandals", warmth: 1 });
  const calm = { temperature: 16, rain: false };
  const windy = { temperature: 16, rain: false, wind: 40 };
  assert.ok(weatherFit([top, jeans], windy) < weatherFit([top, jeans], calm));
  assert.ok(weatherFit([top, jeans, jacket], windy) > weatherFit([top, jeans], windy));
  assert.ok(weatherFit([top, jeans, sandals], { temperature: 16, rain: true, rainMm: 9 }) < weatherFit([top, jeans, sandals], { temperature: 16, rain: true, rainMm: 1 }));
  const outfit = makeOutfit({ items: [top, jeans, jacket], today, weather: windy });
  assert.ok(outfit.garmentIds.includes("jacket"));
  assert.ok(outfit.why.some(([text]) => /wind/.test(text)));
});

test("a tile says in a few words how a piece pairs", () => {
  assert.equal(tileNote(piece("a", "upperbody", "#111111")), "Goes with any color");
  assert.equal(tileNote(piece("b", "upperbody", "#d03030")), "Best with neutrals");
  assert.equal(tileNote(piece("c", "upperbody", "#d03030", { pattern: "floral" })), "Keep the rest plain");
  assert.equal(tileNote({}), "");
});
