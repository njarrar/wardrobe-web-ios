// Puts an outfit together on the device, with no AI. It picks one piece per
// slot, tries a few hundred mixes and keeps the one that scores best on
// color, weather, how dressy the pieces are and how long they have rested.
// Pure functions, so they run in the browser, Node and the Worker.

import { colorHarmony, COLOR_RULES, dayString, daysBetween, feelsLike, idleDays, isNeutral, isWetDay, itemWarmth, lastWorn, targetWarmth, weatherFit } from "./style.mjs";

// "dress" and "sundress" count; "dress shirt" and "dress shoes" do not.
const ONE_PIECE = /\b\w*dress\b(?![- ]?(shirt|shoe|pant|trouser|sock|boot|watch|belt))|jumpsuit|romper|abaya|thobe|kandura|dishdasha|jalabiya|kaftan/;
const DRESSY = { casual: 0, smart: 1, formal: 2 };
const SEASON_BY_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];

// A piece worn in the last REST_DAYS days sits this one out when it can.
export const REST_DAYS = 2;

export function isOnePiece(item) {
  return ONE_PIECE.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
}

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

// Head covers worn with every outfit by those who own them.
const isHijab = (item) => /hijab|headscarf|shayla/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
const isShemagh = (item) => /shemagh|ghutra|keffiyeh/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());
const isThobe = (item) => /thobe|kandura|dishdasha/.test(`${item?.kind || ""} ${item?.name || ""}`.toLowerCase());

// How good one piece is for today, before it meets the others.
function pieceScore(item, { today, target, season, rest }) {
  let score = Math.min(90, idleDays(item, today) ?? 30) / 9; // up to 10 for a long rest
  if (!rested(item, today, rest)) score -= 12;
  if (target) score -= Math.abs(itemWarmth(item) - target) * 2.5;
  if (item.seasons?.length && !item.seasons.includes(season)) score -= 3;
  return score;
}

function dressGap(pieces) {
  const levels = pieces.map((piece) => DRESSY[piece.formality]).filter((level) => level !== undefined);
  return levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;
}

function mixScore(pieces, context) {
  const harmony = colorHarmony(pieces.map((piece) => piece.color).filter(Boolean));
  let score = harmony.score;
  score += pieces.reduce((total, piece) => total + pieceScore(piece, context), 0) / pieces.length * 2;
  if (context.weather) score += weatherFit(pieces, context.weather) * 30;
  score -= dressGap(pieces) * 9;
  if (context.dress && pieces.some((piece) => piece.formality && piece.formality !== context.dress)) {
    score -= pieces.filter((piece) => piece.formality && piece.formality !== context.dress).length * 6;
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

// Can this closet make an outfit at all?
export function canMakeOutfit(items = []) {
  const tops = items.filter((item) => item.part === "upperbody");
  return tops.some(isOnePiece) || (tops.some((item) => !isOnePiece(item)) && items.some((item) => item.part === "lowerbody"));
}

// One outfit for today. locked holds ids of pieces that must stay. rejected
// holds keys (see outfitKey) of mixes the person said no to. Seed counts the
// shuffles: each one gives the next mix. dress is "casual", "smart" or "formal" when the day calls for it.
export function makeOutfit({ items = [], today = dayString(), weather = null, locked = [], rejected = [], seed = 0, dress = "", rest = REST_DAYS, tries = 240 } = {}) {
  if (!canMakeOutfit(items)) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = [...new Set(locked)].map((id) => byId.get(id)).filter(Boolean);
  const target = weather && Number.isFinite(weather.temperature) ? targetWarmth(feelsLike(weather)) : 0;
  const context = { today, target, weather, dress, rest, season: SEASON_BY_MONTH[Number(today.slice(5, 7)) - 1] };
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
  const windy = (Number(weather?.wind) || 0) >= 30;
  const keptIn = (part, test = () => true) => kept.find((item) => item.part === part && test(item));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const canPair = slots.top.length && slots.bottom.length;

  const found = new Map();
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const pieces = [];
    const keptOnePiece = keptIn("upperbody", isOnePiece);
    const keptTop = keptIn("upperbody", (item) => !isOnePiece(item));
    const keptBottom = keptIn("lowerbody");
    const whole = keptOnePiece || (!keptTop && !keptBottom && slots.onePiece.length && (!canPair || random() < slots.onePiece.length / (slots.onePiece.length + slots.top.length)));
    if (whole) pieces.push(keptOnePiece || pick(slots.onePiece));
    else {
      const top = keptTop || (slots.top.length ? pick(slots.top) : null);
      const bottom = keptBottom || (slots.bottom.length ? pick(slots.bottom) : null);
      if (!top || !bottom) continue;
      pieces.push(top, bottom);
    }
    const layer = keptIn("wholebody_up") || (slots.layer.length && (target >= 4 || (target === 3 && (windy || random() < 0.6)) || (!target && random() < 0.3)) ? pick(slots.layer) : null);
    if (layer) pieces.push(layer);
    const shoes = keptIn("shoes") || (slots.shoes.length ? pick(slots.shoes) : null);
    if (shoes) pieces.push(shoes);
    // A hijab goes with every outfit but a thobe; a shemagh goes with a thobe.
    const cover = isThobe(pieces[0]) ? slots.shemagh : slots.hijab;
    const extra = keptIn("accessories_up") || (cover.length ? pick(cover) : slots.extra.length && random() < 0.35 ? pick(slots.extra) : null);
    if (extra) pieces.push(extra);

    const key = outfitKey(pieces.map((piece) => piece.id));
    if (no.has(key) || found.has(key)) continue;
    found.set(key, { pieces, ...mixScore(pieces, context) });
  }
  if (!found.size) return null;
  // Seed 0 is the best mix. Each shuffle steps down the better half of the
  // list, then starts over.
  const ranked = [...found.values()].sort((a, b) => b.score - a.score);
  const span = Math.min(ranked.length, Math.max(3, Math.ceil(ranked.length / 2)));
  const best = ranked[Math.abs(Math.trunc(Number(seed)) || 0) % span];
  return {
    garmentIds: best.pieces.map((piece) => piece.id),
    pieces: best.pieces,
    key: outfitKey(best.pieces.map((piece) => piece.id)),
    harmony: best.harmony,
    why: reasons(best.pieces, { harmony: best.harmony, weather, today }),
  };
}

// Several outfits that differ from each other and from the ones already saved.
export function makeOutfits({ count = 4, outfits = [], rejected = [], seed = 0, ...rest } = {}) {
  const taken = new Set([...rejected, ...outfits.map((outfit) => outfitKey(outfit.garmentIds || []))]);
  const made = [];
  for (let round = 0; round < count * 6 && made.length < count; round += 1) {
    const outfit = makeOutfit({ ...rest, rejected: [...taken], seed: round ? 0 : seed });
    if (!outfit) break;
    taken.add(outfit.key);
    made.push(outfit);
  }
  return made;
}

// "White tee with grey jeans", from the two main pieces.
export function outfitTitle(pieces) {
  const main = pieces.filter((piece) => piece.part === "upperbody" || piece.part === "lowerbody");
  const names = (main.length ? main : pieces).slice(0, 2).map((piece) => piece.name).filter(Boolean);
  return names.join(" + ").slice(0, 80) || "My outfit";
}
