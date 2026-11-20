// Puts an outfit together on the device, with no AI. It picks one piece per
// slot, tries a few hundred mixes and keeps the one that scores best on
// color, weather, how dressy the pieces are and how long they have rested.
// Pure functions, so they run in the browser, Node and the Worker.

import { canMakeOutfit, isOnePiece } from "./core.mjs";
import { colorHarmony, COLOR_RULES, dayString, daysBetween, feelsLike, idleDays, isNeutral, isWetDay, itemWarmth, lastWorn, targetWarmth, weatherFit } from "./style.mjs";

const DRESSY = { casual: 0, smart: 1, formal: 2 };
const SEASON_BY_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];
const RAIN_LAYER = /\b(rain|trench|waterproof|anorak|mac|shell)\b/;
const MENS_TAILORING = /\b(tuxedo|men'?s|suit|tie|necktie|bowtie|bisht)\b/;

// A piece worn in the last REST_DAYS days sits this one out when it can.
export const REST_DAYS = 2;

export { canMakeOutfit, isOnePiece };

// The same pieces always give the same key, in any order.
export function outfitKey(ids) {
  return [...new Set(ids)].sort().join("+");
}

function randomFrom(seed) {
  let state = [...String(seed)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function rested(item, today, rest = REST_DAYS) {
  const last = lastWorn(item);
  return !last || daysBetween(last, today) > rest;
}

// Head covers worn by those who own them.
const isHijab = (item) => /\b(hijab|headscarf|shayla)\b/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
const isShemagh = (item) => /\b(shemagh|ghutra|keffiyeh)\b/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
const isThobe = (item) => /\b(thobe|kandura|dishdasha)\b/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
const isRainLayer = (item) => RAIN_LAYER.test(`${item?.kind || ""} ${item?.name || ""} ${(item?.tags || []).join(" ")}`.toLowerCase());
const isMensLook = (pieces) => pieces.some((item) => MENS_TAILORING.test(`${item?.kind || ""} ${item?.name || ""} ${(item?.tags || []).join(" ")}`.toLowerCase()));

function seasonFor(today, weather) {
  const rawMonth = Number(String(today || "").slice(5, 7)) - 1;
  if (!Number.isInteger(rawMonth) || rawMonth < 0 || rawMonth > 11) return null;
  const shifted = Number(weather?.lat) < 0 ? (rawMonth + 6) % 12 : rawMonth;
  return SEASON_BY_MONTH[shifted] || null;
}

function fitsRule(found, wanted) {
  return found === wanted || (wanted === "tonal" && found === "accent");
}

// How good one piece is for today, before it meets the others.
function pieceScore(item, { today, target, season, rest, dress, preferSet, lockedColors }) {
  let score = Math.min(90, idleDays(item, today) ?? 30) / 9; // up to 10 for a long rest
  if (!rested(item, today, rest)) score -= 12;
  if (target) score -= Math.abs(itemWarmth(item) - target) * 2.5;
  if (season && item.seasons?.length && !item.seasons.includes(season)) score -= 3;
  if (dress && item.formality) score += item.formality === dress ? 6 : -6;
  if (preferSet?.has(item.id)) score += 6;
  if (lockedColors?.length && item.color) {
    const colors = [...lockedColors, item.color, ...(item.secondaryColor ? [item.secondaryColor] : [])];
    score += (colorHarmony(colors).score - 60) / 10;
  }
  return score;
}

function dressGap(pieces) {
  const levels = pieces.map((piece) => DRESSY[piece.formality]).filter((level) => level !== undefined);
  return levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;
}

function mixScore(pieces, context) {
  const colors = [];
  for (const piece of pieces) {
    if (piece.color) colors.push(piece.color);
    if (piece.secondaryColor) colors.push(piece.secondaryColor);
  }
  const harmony = colorHarmony(colors);
  let score = harmony.score;
  score += pieces.reduce((total, piece) => total + pieceScore(piece, context), 0) / pieces.length * 2;
  if (context.weather) score += weatherFit(pieces, context.weather) * 30;
  score -= dressGap(pieces) * 9;
  if (context.dress && pieces.some((piece) => piece.formality && piece.formality !== context.dress)) {
    score -= pieces.filter((piece) => piece.formality && piece.formality !== context.dress).length * 6;
  }
  if (context.rule) {
    if (fitsRule(harmony.rule, context.rule)) score += 25;
    else score -= 10;
  }
  if (context.preferSet?.size) {
    score += pieces.filter((piece) => context.preferSet.has(piece.id)).length * 8;
  }
  return { score, harmony };
}

// Plain reasons, as [text, values] pairs the app can show in its own language.
function reasons(pieces, { harmony, weather, today }) {
  const why = [];
  const loud = pieces.filter((piece) => piece.color && !isNeutral(piece.color));
  if (harmony.rule === "accent" && loud.length === 1) why.push(["Calm colors, with {name} as the one accent.", { name: loud[0].name }]);
  else if (harmony.rule === "tonal" && !loud.length) why.push(["Calm colors that go with each other."]);
  else if (COLOR_RULES[harmony.rule] && harmony.rule !== "free") why.push([COLOR_RULES[harmony.rule].hint]);
  if (weather && Number.isFinite(weather.temperature)) {
    const fit = weatherFit(pieces, weather);
    const windy = (Number(weather.wind) || 0) >= 30;
    const layered = pieces.some((piece) => piece.part === "wholebody_up");
    if (fit >= 0.6 && windy && layered) why.push(["Right for {n}°, with a layer for the wind.", { n: Math.round(weather.temperature) }]);
    else if (fit >= 0.6) why.push([isWetDay(weather) ? "Right for {n}° and rain." : "Right for {n}° today.", { n: Math.round(weather.temperature) }]);
  }
  const longest = pieces.map((piece) => ({ piece, idle: idleDays(piece, today) })).filter(({ piece, idle }) => lastWorn(piece) && idle >= 30).sort((a, b) => b.idle - a.idle)[0];
  if (longest) why.push(["{name}: not worn in {n} days.", { name: longest.piece.name, n: longest.idle }]);
  else {
    const fresh = pieces.find((piece) => !lastWorn(piece));
    if (fresh) why.push(["{name}: not worn yet.", { name: fresh.name }]);
  }
  return why.slice(0, 3);
}

function rankOutfits({ items = [], today = dayString(), weather = null, locked = [], rejected = [], dress = "", rest = REST_DAYS, tries = 240, rule = "", preferIds = [], headCover = "auto" } = {}) {
  if (!canMakeOutfit(items)) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = [...new Set(locked)].map((id) => byId.get(id)).filter(Boolean);
  const lockedColors = kept.flatMap((item) => [item.color, item.secondaryColor].filter(Boolean));
  const preferSet = Array.isArray(preferIds) && preferIds.length ? new Set(preferIds) : null;
  const target = weather && Number.isFinite(weather.temperature) ? targetWarmth(feelsLike(weather)) : 0;
  const context = { today, target, weather, dress, rest, rule, preferSet, lockedColors, season: seasonFor(today, weather) };
  const random = randomFrom(today);
  const no = new Set(rejected);

  // Each slot offers its best few pieces, so the search stays small in a big closet.
  const pool = (test) => {
    const all = items.filter(test);
    const fresh = all.filter((item) => rested(item, today, rest));
    return (fresh.length ? fresh : all)
      .map((item) => ({ item, score: pieceScore(item, context) + random() * 4 }))
      .sort((a, b) => b.score - a.score).slice(0, 12).map(({ item }) => item);
  };
  const slots = {
    top: pool((item) => item.part === "upperbody" && !isOnePiece(item)),
    onePiece: pool((item) => item.part === "upperbody" && isOnePiece(item)),
    bottom: pool((item) => item.part === "lowerbody"),
    layer: pool((item) => item.part === "wholebody_up"),
    shoes: pool((item) => item.part === "shoes"),
    extra: pool((item) => item.part === "accessories_up" && !isHijab(item) && !isShemagh(item)),
    hijab: pool((item) => item.part === "accessories_up" && isHijab(item)),
    shemagh: pool((item) => item.part === "accessories_up" && isShemagh(item)),
  };

  const keptOnePieces = kept.filter((item) => item.part === "upperbody" && isOnePiece(item));
  const keptTops = kept.filter((item) => item.part === "upperbody" && !isOnePiece(item));
  const keptBottoms = kept.filter((item) => item.part === "lowerbody");
  const keptLayers = kept.filter((item) => item.part === "wholebody_up");
  const keptShoes = kept.filter((item) => item.part === "shoes");
  const keptCovers = kept.filter((item) => item.part === "accessories_up" && (isHijab(item) || isShemagh(item)));
  const keptExtras = kept.filter((item) => item.part === "accessories_up" && !isHijab(item) && !isShemagh(item));

  // Feasibility check up front so impossible lock combinations fail immediately.
  if (!keptOnePieces.length) {
    if (keptTops.length && !keptBottoms.length && !slots.bottom.length) return [];
    if (keptBottoms.length && !keptTops.length && !slots.top.length) return [];
  }

  const windy = (Number(weather?.wind) || 0) >= 30;
  const wet = isWetDay(weather);
  const rainLayers = wet ? slots.layer.filter(isRainLayer) : [];
  const pick = (list) => list[Math.floor(random() * list.length)];
  const canPair = slots.top.length && slots.bottom.length;

  const found = new Map();
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const pieces = [];
    const whole = keptOnePieces.length > 0 || (!keptTops.length && !keptBottoms.length && slots.onePiece.length && (!canPair || random() < slots.onePiece.length / (slots.onePiece.length + slots.top.length)));
    if (whole) {
      if (keptOnePieces.length) pieces.push(...keptOnePieces);
      else pieces.push(pick(slots.onePiece));
      // Never silently drop explicitly locked tops or bottoms alongside a locked one-piece.
      if (keptTops.length) pieces.push(...keptTops);
      if (keptBottoms.length) pieces.push(...keptBottoms);
    } else {
      const tops = keptTops.length ? keptTops : (slots.top.length ? [pick(slots.top)] : []);
      const bottoms = keptBottoms.length ? keptBottoms : (slots.bottom.length ? [pick(slots.bottom)] : []);
      if (!tops.length || !bottoms.length) continue;
      pieces.push(...tops, ...bottoms);
    }

    if (keptLayers.length) {
      pieces.push(...keptLayers);
    } else if (slots.layer.length) {
      if (target >= 4 || (target === 3 && (windy || wet || random() < 0.6)) || (!target && random() < 0.3)) {
        pieces.push(pick(wet && rainLayers.length && random() < 0.7 ? rainLayers : slots.layer));
      } else if (wet && rainLayers.length) {
        pieces.push(pick(rainLayers));
      }
    }

    if (keptShoes.length) pieces.push(...keptShoes);
    else if (slots.shoes.length) pieces.push(pick(slots.shoes));

    // Dedicated head-cover slot, separate from bags/watches/scarves (slots.extra).
    if (keptCovers.length) {
      pieces.push(...keptCovers);
    } else if (headCover !== false) {
      const primary = pieces[0];
      if (isThobe(primary) && slots.shemagh.length) pieces.push(pick(slots.shemagh));
      else if (!isThobe(primary) && slots.hijab.length && !isMensLook(pieces)) pieces.push(pick(slots.hijab));
    }

    if (keptExtras.length) pieces.push(...keptExtras);
    else if (slots.extra.length && random() < 0.35) pieces.push(pick(slots.extra));

    const key = outfitKey(pieces.map((piece) => piece.id));
    if (no.has(key) || found.has(key)) continue;
    found.set(key, { pieces, ...mixScore(pieces, context) });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

function formatOutfit(entry, { weather, today }) {
  return {
    garmentIds: entry.pieces.map((piece) => piece.id),
    pieces: entry.pieces,
    key: outfitKey(entry.pieces.map((piece) => piece.id)),
    harmony: entry.harmony,
    why: reasons(entry.pieces, { harmony: entry.harmony, weather, today }),
  };
}

// One outfit for today. locked holds ids of pieces that must stay. rejected
// holds keys (see outfitKey) of mixes the person said no to. Seed counts the
// shuffles: each one gives the next mix. dress is "casual", "smart" or "formal" when the day calls for it.
export function makeOutfit({ items = [], today = dayString(), weather = null, locked = [], rejected = [], seed = 0, dress = "", rest = REST_DAYS, tries = 240, rule = "", preferIds = [], headCover = "auto" } = {}) {
  const ranked = rankOutfits({ items, today, weather, locked, rejected, dress, rest, tries, rule, preferIds, headCover });
  if (!ranked.length) return null;
  // Seed 0 is the best mix. Each shuffle steps down the better half of the
  // list, then starts over.
  const span = Math.min(ranked.length, Math.max(3, Math.ceil(ranked.length / 2)));
  const step = Math.trunc(Number(seed)) || 0;
  const best = ranked[((step % span) + span) % span];
  return formatOutfit(best, { weather, today });
}

// Several outfits that differ from each other and from the ones already saved.
// Ranks candidate mixes once rather than repeating Monte Carlo trials per outfit.
export function makeOutfits({ count = 4, outfits = [], rejected = [], seed = 0, tries, ...rest } = {}) {
  const taken = [...new Set([...rejected, ...outfits.map((outfit) => outfitKey(outfit.garmentIds || []))])];
  const ranked = rankOutfits({ ...rest, rejected: taken, tries: tries ?? Math.max(240, count * 80) });
  if (!ranked.length) return [];
  const start = seed ? Math.abs(Math.trunc(Number(seed)) || 0) % ranked.length : 0;
  const ordered = start ? [...ranked.slice(start), ...ranked.slice(0, start)] : ranked;
  return ordered.slice(0, count).map((entry) => formatOutfit(entry, { weather: rest.weather || null, today: rest.today || dayString() }));
}

// "White tee with grey jeans", from the two main pieces.
export function outfitTitle(pieces) {
  const main = pieces.filter((piece) => piece.part === "upperbody" || piece.part === "lowerbody");
  const names = (main.length ? main : pieces).slice(0, 2).map((piece) => piece.name).filter(Boolean);
  return names.join(" + ").slice(0, 80) || "My outfit";
}

// Same-slot alternatives for swapping one piece out of an outfit, ranked by
// how well each candidate harmonizes with the remaining pieces and weather.
export function swapCandidates(piece, pieces = [], items = [], { today = dayString(), weather = null, dress = "", rest = REST_DAYS } = {}) {
  if (!piece) return [];
  const otherIds = new Set(pieces.filter((entry) => entry && entry.id !== piece.id).map((entry) => entry.id));
  const others = pieces.filter((entry) => entry && entry.id !== piece.id);
  const wantOnePiece = piece.part === "upperbody" ? isOnePiece(piece) : null;
  const target = weather && Number.isFinite(weather.temperature) ? targetWarmth(feelsLike(weather)) : 0;
  const context = { today, target, weather, dress, rest, season: SEASON_BY_MONTH[Number(today.slice(5, 7)) - 1] };
  return items
    .filter((candidate) => {
      if (!candidate || candidate.id === piece.id || otherIds.has(candidate.id)) return false;
      if (candidate.part !== piece.part) return false;
      if (wantOnePiece !== null && isOnePiece(candidate) !== wantOnePiece) return false;
      return true;
    })
    .map((candidate) => ({ candidate, score: mixScore([...others, candidate], context).score }))
    .sort((a, b) => b.score - a.score)
    .map(({ candidate }) => candidate);
}
