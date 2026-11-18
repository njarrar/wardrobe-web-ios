import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeSvg, SHAPES } from "../shared/shapes.mjs";
import { STARTER_COLORS, STARTER_PIECES } from "../shared/starter.mjs";
import { checkPng, garmentFileName, newPieceRecord } from "../shared/core.mjs";
import { idleLabel } from "../shared/style.mjs";
import { describeCode, forecastUrl, parseForecast, roundCoord } from "../src/weather.js";
import { AR } from "../src/i18n-ar.js";
import { t, tn, setLanguage } from "../src/i18n.js";

test("every starter piece has a shape, a starter color and sort fields", () => {
  const hexes = new Set(STARTER_COLORS.map((entry) => entry.hex));
  for (const piece of STARTER_PIECES) {
    assert.ok(SHAPES[piece.shape], piece.id);
    assert.ok(hexes.has(piece.color), piece.id);
    assert.match(shapeSvg(piece.shape, piece.color), /^<svg/);
    assert.ok(piece.kind && piece.seasons.length && piece.warmth >= 1 && piece.warmth <= 5 && piece.formality, piece.id);
  }
  assert.equal(new Set(STARTER_PIECES.map((piece) => piece.id)).size, STARTER_PIECES.length);
});

test("a drawn piece becomes a normal record", () => {
  const record = newPieceRecord({ name: " White tee ", part: "upperbody", color: "#F3F1EC", tags: ["cotton"], kind: "tee", warmth: 1, starter: true }, "import-x", "/api/import/library/x.png");
  assert.equal(record.name, "White tee");
  assert.equal(record.color, "#f3f1ec");
  assert.equal(record.kind, "tee");
  assert.equal(record.starter, true);
  assert.equal(record.thumbnail, record.image);
});

test("checkPng takes PNGs only, and not too big", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.equal(checkPng(png), png);
  assert.throws(() => checkPng(Buffer.from("GIF89a")), (error) => error.status === 415);
  assert.throws(() => checkPng(Buffer.alloc(0)), (error) => error.status === 413);
  assert.notEqual(garmentFileName("import-a"), "import-a-garment.png");
  assert.match(garmentFileName("import-a"), /^import-a-garment-\w+\.png$/);
});

test("weather: rough location, codes and daily forecast", () => {
  assert.equal(roundCoord(25.2048), 25.2);
  assert.equal(roundCoord(55.2708), 55.3);
  assert.match(forecastUrl(25.2048, 55.2708), /latitude=25\.2&longitude=55\.3/);
  assert.deepEqual(describeCode(63), { label: "Rain", rain: true });
  assert.equal(describeCode(0).rain, false);
  const forecast = parseForecast({ daily: { time: ["2026-11-18", "2026-11-19"], temperature_2m_max: [30, 12], temperature_2m_min: [20, 4], weather_code: [0, 61], precipitation_probability_max: [0, 80] } });
  assert.equal(forecast["2026-11-18"].temperature, 26);
  assert.equal(forecast["2026-11-18"].rain, false);
  assert.equal(forecast["2026-11-19"].rain, true);
  assert.deepEqual(parseForecast({}), {});
});

test("Arabic: every value is filled, and {name} parts match the English", () => {
  for (const [english, arabic] of Object.entries(AR)) {
    assert.ok(arabic.trim(), english);
    const parts = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const mustKeep = parts(english).filter((name) => !(name === "n" && /واحد/.test(arabic)));
    for (const name of mustKeep) assert.ok(parts(arabic).includes(name), `${english} lost {${name}}`);
  }
});

test("t and tn pick the language and fill in values", () => {
  setLanguage("en");
  assert.equal(t("Plan"), "Plan");
  assert.equal(tn(3, "{n} piece", "{n} pieces"), "3 pieces");
  setLanguage("ar");
  assert.equal(t("Plan"), "الخطة");
  assert.equal(t("Some text with no Arabic"), "Some text with no Arabic");
  assert.equal(tn(1, "{n} piece", "{n} pieces"), "1 قطعة");
  assert.equal(idleLabel({ addedAt: "2026-01-01T00:00:00Z", wornDates: ["2026-11-08"] }, "2026-11-18", t), "منذ 10 يومًا");
  setLanguage("en");
});
