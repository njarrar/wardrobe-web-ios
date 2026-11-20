// Styling helpers shared by the app and the servers: color wheel rules, the
// wear log, forgotten pieces, today's outfit, cost per wear and the month
// plan. Pure functions only, so they run in the browser, Node and the Worker.

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_WEAR_DATES = 730;

// ---------- dates ----------

// "2026-11-18" in the device's own time zone.
export function dayString(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function parseDay(day) {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function addDays(day, count) {
  const value = parseDay(day);
  value.setDate(value.getDate() + count);
  return dayString(value);
}

function utcDayMs(day) {
  const [year, month, date] = String(day).split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

export function daysBetween(from, to) {
  return Math.round((utcDayMs(to) - utcDayMs(from)) / 86400000);
}

export function isDay(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  return dayString(parseDay(value)) === value;
}

// Adds or removes one date from a list of worn dates, kept sorted and capped.
export function editWornDates(list, { wear, unwear } = {}) {
  let dates = Array.isArray(list) ? list.filter(isDay) : [];
  if (wear !== undefined) {
    if (!isDay(wear)) throw Object.assign(new Error("wear must be a date like 2026-11-18"), { status: 400 });
    dates = [...dates, wear];
  }
  if (unwear !== undefined) {
    if (!isDay(unwear)) throw Object.assign(new Error("unwear must be a date like 2026-11-18"), { status: 400 });
    dates = dates.filter((day) => day !== unwear);
  }
  return [...new Set(dates)].sort().slice(-MAX_WEAR_DATES);
}

// ---------- wear log ----------

export function wearCount(record) {
  return Array.isArray(record?.wornDates) ? record.wornDates.length : 0;
}

export function lastWorn(record) {
  const dates = Array.isArray(record?.wornDates) ? record.wornDates.filter(isDay) : [];
  if (!dates.length) return null;
  return dates.reduce((max, day) => (day > max ? day : max));
}

// Days since a piece was last worn. Never worn counts from the day it was added.
export function idleDays(record, today = dayString()) {
  const last = lastWorn(record);
  if (last) return Math.max(0, daysBetween(last, today));
  if (record?.addedAt) {
    const added = new Date(record.addedAt);
    if (Number.isNaN(added.getTime())) return null;
    return Math.max(0, daysBetween(dayString(added), today));
  }
  return null;
}

// Pieces that have sat in the closet for a while, longest first.
export function forgottenPieces(items, { today = dayString(), days = 60 } = {}) {
  return items
    .map((item) => ({ item, idle: idleDays(item, today) }))
    .filter(({ idle }) => idle !== null && idle >= days)
    .sort((a, b) => b.idle - a.idle)
    .map(({ item, idle }) => ({ ...item, idleDays: idle }));
}

// "Today", "Yesterday", "12 days ago", "1 month ago", "3 months ago", "Since Feb 2025".
const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text);

// tr and loc let the app show the label in its own language.
export function idleLabel(record, today = dayString(), tr = fill, loc = "en-GB") {
  const last = lastWorn(record);
  const idle = idleDays(record, today);
  if (idle === null) return "";
  if (!last) return tr(idle < 1 ? "Added today" : "Never worn");
  if (idle === 0) return tr("Worn today");
  if (idle === 1) return tr("Worn yesterday");
  if (idle < 30) return tr("{n} days ago", { n: idle });
  if (idle < 45) return tr("1 month ago");
  if (idle < 300) return tr("{n} months ago", { n: Math.round(idle / 30) });
  return tr("Since {date}", { date: parseDay(last).toLocaleDateString(loc, { month: "short", year: "numeric" }) });
}

export function costPerWear(item) {
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return price / Math.max(1, wearCount(item));
}

export function formatMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value >= 10 ? String(Math.round(value)) : value.toFixed(2).replace(/\.00$/, "");
}

// ---------- color wheel ----------

export function hexToHsl(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { hue: 0, sat: 0, light };
  const sat = delta / (1 - Math.abs((2 * light) - 1));
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = ((blue - red) / delta) + 2;
  else hue = ((red - green) / delta) + 4;
  return { hue: (hue * 60 + 360) % 360, sat, light };
}

// Black, white, grey, beige, camel, brown and navy go with anything, so the
// wheel ignores them. Everything else is a hue on the wheel.
export function isNeutral(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return true;
  const { hue, sat, light } = hsl;
  if (light < 0.16 || light > 0.9 || sat < 0.18) return true;
  if (hue >= 18 && hue < 55 && (sat < 0.5 || light < 0.42)) return true; // beige, camel, brown
  if (hue >= 200 && hue < 245 && light < 0.36) return true; // navy
  return false;
}

function hueGap(a, b) {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

// The smallest arc of the wheel that holds every hue.
function hueSpan(hues) {
  if (hues.length < 2) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let widestGap = 360 - sorted[sorted.length - 1] + sorted[0];
  for (let i = 1; i < sorted.length; i += 1) widestGap = Math.max(widestGap, sorted[i] - sorted[i - 1]);
  return 360 - widestGap;
}

// Hues closer than this count as one color.
const SAME_HUE = 28;

function circularHueMean(hues) {
  let sin = 0;
  let cos = 0;
  for (const hue of hues) {
    const rad = (hue * Math.PI) / 180;
    sin += Math.sin(rad);
    cos += Math.cos(rad);
  }
  return ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
}

function hueGroups(hues) {
  const groups = [];
  for (const hue of [...hues].sort((a, b) => a - b)) {
    const group = groups.find((entry) => hueGap(entry.hue, hue) <= SAME_HUE);
    if (group) {
      group.hues.push(hue);
      group.hue = circularHueMean(group.hues);
    } else {
      groups.push({ hue, hues: [hue] });
    }
  }
  return groups.map((group) => group.hue);
}

export const COLOR_RULES = {
  tonal: { label: "Tonal", hint: "Neutrals and one color family, calm and easy." },
  accent: { label: "One accent", hint: "Neutrals with a single color that leads." },
  neighbors: { label: "Neighbors", hint: "Colors that sit next to each other on the wheel." },
  opposites: { label: "Opposites", hint: "Two colors from across the wheel, one in charge." },
  "three-way": { label: "Three-way", hint: "Three colors spaced evenly around the wheel." },
  free: { label: "Free mix", hint: "Breaks the usual rules." },
};
export const COLOR_RULE_IDS = ["tonal", "neighbors", "opposites", "three-way"];

// Reads an outfit's colors and says which wheel rule it follows, with a
// score out of 100.
export function colorHarmony(colors) {
  const valid = colors.filter((hex) => hexToHsl(hex));
  if (!valid.length) return { rule: "tonal", score: 70, hues: [] };
  const chromatic = valid.filter((hex) => !isNeutral(hex));
  const hues = chromatic.map((hex) => hexToHsl(hex).hue);
  const groups = hueGroups(hues);
  let rule;
  let score;
  if (chromatic.length === 1) {
    rule = "accent"; score = 92;
  } else if (groups.length <= 1) {
    rule = "tonal"; score = 90;
  } else if (hueSpan(groups) <= 75) {
    rule = "neighbors"; score = 88;
  } else if (groups.length === 2 && Math.abs(hueGap(groups[0], groups[1]) - 180) <= 40) {
    rule = "opposites"; score = 86 + Math.round((40 - Math.abs(hueGap(groups[0], groups[1]) - 180)) / 8);
  } else if (groups.length === 3 && [[0, 1], [1, 2], [0, 2]].every(([a, b]) => Math.abs(hueGap(groups[a], groups[b]) - 120) <= 30)) {
    rule = "three-way"; score = 84;
  } else {
    rule = "free"; score = 52 - (groups.length - 2) * 10;
  }
  // Too many loud pieces fight each other; a light and dark mix reads better.
  const loud = chromatic.filter((hex) => { const { sat, light } = hexToHsl(hex); return sat > 0.6 && light > 0.3 && light < 0.75; }).length;
  if (loud > 2) score -= (loud - 2) * 8;
  const lights = valid.map((hex) => hexToHsl(hex).light);
  if (Math.max(...lights) - Math.min(...lights) >= 0.3) score += 5;
  return { rule, score: Math.max(20, Math.min(99, Math.round(score))), hues: groups.map(Math.round) };
}

export function outfitColors(outfit, itemsById) {
  const colors = [];
  for (const id of outfit?.garmentIds || []) {
    const item = itemsById.get(id);
    if (item?.color) colors.push(item.color);
    if (item?.secondaryColor) colors.push(item.secondaryColor);
  }
  return colors;
}

export function outfitHarmony(outfit, itemsById) {
  return colorHarmony(outfitColors(outfit, itemsById));
}

// ---------- today's outfit ----------

function seededOrder(list, seed) {
  let state = [...String(seed)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  return list.map((entry) => ({ entry, key: random() })).sort((a, b) => a.key - b.key).map(({ entry }) => entry);
}

// A saved outfit for today: one from the plan if there is one, else one not
// worn in the last week, leaning on outfits with forgotten pieces. shuffle
// moves to the next pick.
export function todaysOutfit({ outfits = [], items = [], plan = null, today = dayString(), shuffle = 0, weather = null } = {}) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const usable = outfits.filter((outfit) => (outfit.garmentIds || []).every((id) => itemsById.has(id)) && (outfit.garmentIds || []).length >= 2);
  const step = Math.trunc(Number(shuffle)) || 0;
  const planned = plan?.days?.[today];
  if (!step && planned && usable.some((outfit) => outfit.id === planned)) return { outfit: usable.find((outfit) => outfit.id === planned), planned: true };
  if (!usable.length) return null;
  const candidates = step > 0 && planned && usable.length > 1 ? usable.filter((outfit) => outfit.id !== planned) : usable;
  const rested = candidates.filter((outfit) => { const last = lastWorn(outfit); return !last || daysBetween(last, today) >= 7; });
  const pool = rested.length ? rested : candidates;
  const scored = pool.map((outfit) => {
    const pieces = outfit.garmentIds.map((id) => itemsById.get(id));
    const idle = pieces.reduce((total, piece) => total + Math.min(120, idleDays(piece, today) || 0), 0) / pieces.length;
    return { outfit, score: idle + (weather ? weatherFit(pieces, weather) * 40 : 0) };
  }).sort((a, b) => b.score - a.score);
  const top = seededOrder(scored.slice(0, Math.max(3, Math.ceil(scored.length / 2))), today);
  const index = ((step % top.length) + top.length) % top.length;
  return { outfit: top[index].outfit, planned: false };
}

// ---------- warmth and weather ----------

// 1 (very light) to 5 (very warm), from what the AI said or from the tags.
export function itemWarmth(item) {
  const warmth = Number(item?.warmth);
  if (Number.isInteger(warmth) && warmth >= 1 && warmth <= 5) return warmth;
  const text = [item?.kind, item?.name, ...(item?.tags || [])].filter(Boolean).join(" ").toLowerCase();
  if (/\b(down\s+(jacket|coat|vest|parka|gilet)|puffer|parka|wool coat|heavy)\b/.test(text)) return 5;
  if (/\b(wool|knit|sweater|fleece|coat|boots|warm)\b/.test(text)) return 4;
  if (/\b(linen|tank|shorts|sandals?|summer)\b/.test(text)) return 1;
  if (item?.part === "wholebody_up") return 4;
  return 3;
}

// Warmth an outfit should have at this temperature (feels-like, Celsius).
export function targetWarmth(celsius) {
  if (celsius >= 28) return 1;
  if (celsius >= 21) return 2;
  if (celsius >= 14) return 3;
  if (celsius >= 6) return 4;
  return 5;
}

// 1 when the outfit suits the weather, down to 0 when it is far off.
// Wind makes a day feel colder: 2 degrees at 30 km/h, 4 at 45.
export function feelsLike(weather) {
  const wind = Number(weather?.wind) || 0;
  return weather.temperature - (wind >= 45 ? 4 : wind >= 30 ? 2 : 0);
}

// 5 mm in a day is real rain, not a passing shower.
export function isWetDay(weather) {
  return Boolean(weather?.rain) && (!Number.isFinite(weather?.rainMm) || weather.rainMm >= 5);
}

export function weatherFit(pieces, weather) {
  if (!weather || !Number.isFinite(weather.temperature)) return 0.5;
  const target = targetWarmth(feelsLike(weather));
  const core = pieces.filter(Boolean);
  if (!core.length) return 0.5;
  const hasLayer = core.some((piece) => piece.part === "wholebody_up");
  const garments = core.filter((piece) => piece.part === "upperbody" || piece.part === "lowerbody" || piece.part === "wholebody_up");
  const base = core.filter((piece) => piece.part === "upperbody" || piece.part === "lowerbody");
  const warmthSource = garments.length ? garments : core;
  const warmth = Math.max(...warmthSource.map(itemWarmth)) + (hasLayer && target >= 4 ? 0.5 : 0);
  let fit = 1 - Math.min(1, Math.abs(warmth - target) / 3);
  if (target >= 4 && !hasLayer) fit -= 0.25;
  // Torso/legs must also suit cold weather, not just boots or a scarf.
  if (target >= 4 && base.length) {
    const minBase = Math.min(...base.map(itemWarmth));
    if (minBase <= 1) fit -= 0.25;
    else if (target >= 5 && minBase <= 2) fit -= 0.15;
  }
  const words = (piece) => `${piece.kind || ""} ${piece.name || ""} ${(piece.tags || []).join(" ")}`.toLowerCase();
  if (weather.rain && core.some((piece) => /\b(suede|linen)\b/.test(words(piece)))) fit -= 0.2;
  if (isWetDay(weather)) {
    if (core.some((piece) => /sandal|canvas|espadrille|flip/.test(words(piece)))) fit -= 0.25;
    const hasRainShell = core.some((piece) => /\b(rain|trench|waterproof|anorak|mac|shell)\b/.test(words(piece)));
    if (!hasLayer && target >= 3) fit -= 0.1;
    else if (hasRainShell) fit += 0.05;
  }
  if ((Number(weather.wind) || 0) >= 30 && !hasLayer && target >= 3) fit -= 0.15;
  return Math.max(0, Math.min(1, fit));
}

// ---------- month plan ----------

// What a day is for. Each one names how dressy the outfit should be and the
// outfit tags that suit it.
export const OCCASIONS = {
  work: { label: "Work", dress: "smart", words: /work|office|smart|business|meeting/ },
  casual: { label: "Casual", dress: "casual", words: /casual|weekend|everyday|relaxed|errand/ },
  dinner: { label: "Dinner", dress: "smart", words: /dinner|date|evening|night|party/ },
  formal: { label: "Formal", dress: "formal", words: /formal|wedding|event|ceremony|black tie/ },
};
export const OCCASION_IDS = Object.keys(OCCASIONS);

// 1 when an outfit suits the occasion, down to 0. A matching tag settles it;
// else it is the share of pieces at the right dress level.
export function occasionFit(outfit, pieces, occasion) {
  const rule = OCCASIONS[occasion];
  if (!rule) return 0.5;
  if ((outfit?.occasion || []).some((tag) => rule.words.test(tag))) return 1;
  const known = pieces.filter((piece) => piece?.formality);
  if (!known.length) return 0.5;
  return known.filter((piece) => piece.formality === rule.dress).length / known.length;
}

// pieceRest: days a piece rests after it is worn before it is picked again.
export const DEFAULT_PLAN_SETTINGS = { workDays: [0, 1, 2, 3, 4], restDays: 7, mixForgotten: true, pieceRest: 2 };

function isWorkOutfit(outfit) {
  return (outfit.occasion || []).some((tag) => /work|office|smart|business|formal|meeting/.test(tag));
}

// Fills every day from `start` for `length` days with a saved outfit. The same
// outfit never comes back inside `restDays`, the same top never repeats two
// days in a row, work days lean on work outfits, and pieces that have sat for
// a while get a turn. Days already set in `keep` stay as they are.
export function planDays({ outfits = [], items = [], start, length = 30, settings = {}, keep = {}, forecast = {}, occasions = {} } = {}) {
  const options = { ...DEFAULT_PLAN_SETTINGS, ...settings };
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const usable = outfits.filter((outfit) => (outfit.garmentIds || []).length >= 2 && outfit.garmentIds.every((id) => itemsById.has(id)));
  const days = {};
  if (!usable.length || !start) return days;
  const lastUsed = new Map();
  const pieceUses = new Map();
  // The last day each piece was worn or planned, for the piece rest rule.
  const pieceLast = new Map();
  const touch = (id, day) => { if (!pieceLast.has(id) || pieceLast.get(id) < day) pieceLast.set(id, day); };
  const topOf = (outfit) => (outfit?.garmentIds || []).map((id) => itemsById.get(id)).find((piece) => piece?.part === "upperbody")?.id || null;
  for (const item of items) { const last = lastWorn(item); if (last && last < start) touch(item.id, last); }
  const outfitsById = new Map(usable.map((outfit) => [outfit.id, outfit]));
  const validKeep = new Map();
  for (const [day, id] of Object.entries(keep)) {
    if (!isDay(day) || !outfitsById.has(id)) continue;
    validKeep.set(day, outfitsById.get(id));
    if (day < start) {
      if (!lastUsed.has(id) || lastUsed.get(id) < day) lastUsed.set(id, day);
      for (const piece of outfitsById.get(id).garmentIds) touch(piece, day);
    }
  }
  for (const outfit of usable) {
    const last = lastWorn(outfit);
    if (last && last < start && (!lastUsed.has(outfit.id) || lastUsed.get(outfit.id) < last)) lastUsed.set(outfit.id, last);
  }
  const futureKeeps = [...validKeep.entries()].filter(([day]) => day >= start).sort((a, b) => a[0].localeCompare(b[0]));
  let previousTop = topOf(validKeep.get(addDays(start, -1))) || null;
  for (let offset = 0; offset < length; offset += 1) {
    const day = addDays(start, offset);
    const keptOutfit = validKeep.get(day);
    if (keptOutfit) {
      days[day] = keptOutfit.id;
      lastUsed.set(keptOutfit.id, day);
      for (const id of keptOutfit.garmentIds) {
        pieceUses.set(id, (pieceUses.get(id) || 0) + 1);
        touch(id, day);
      }
      previousTop = topOf(keptOutfit);
      continue;
    }
    const work = options.workDays.includes(parseDay(day).getDay());
    const weather = forecast[day] || null;
    const nextKeep = validKeep.get(addDays(day, 1));
    const nextKeepTop = nextKeep ? topOf(nextKeep) : null;
    const scored = usable.map((outfit, index) => {
      const pieces = outfit.garmentIds.map((id) => itemsById.get(id));
      const last = lastUsed.get(outfit.id);
      const since = last ? daysBetween(last, day) : 999;
      let score = Math.min(since, 60);
      if (since < options.restDays) score -= 1000;
      const top = topOf(outfit);
      if (top && top === previousTop) score -= 200;
      if (top && top === nextKeepTop) score -= 200;
      // Look ahead to upcoming pinned days so today's pick does not clash with them.
      for (const [futureDay, futureOutfit] of futureKeeps) {
        if (futureDay <= day) continue;
        const gap = daysBetween(day, futureDay);
        if (gap >= options.restDays && gap > options.pieceRest) break;
        if (gap < options.restDays && futureOutfit.id === outfit.id) score -= 1000;
        if (options.pieceRest > 0 && gap <= options.pieceRest) {
          const futurePieces = new Set(futureOutfit.garmentIds);
          score -= outfit.garmentIds.filter((id) => futurePieces.has(id)).length * 120;
        }
      }
      if (OCCASIONS[occasions[day]]) score += occasionFit(outfit, pieces, occasions[day]) * 60;
      else if (work === isWorkOutfit(outfit)) score += 25;
      if (options.mixForgotten) score += pieces.reduce((total, piece) => total + Math.min(90, idleDays(piece, day) || 0), 0) / pieces.length / 6;
      score -= pieces.reduce((total, piece) => total + (pieceUses.get(piece.id) || 0), 0) * 3;
      if (weather) score += weatherFit(pieces, weather) * 30;
      if (options.pieceRest > 0) score -= pieces.filter((piece) => pieceLast.has(piece.id) && daysBetween(pieceLast.get(piece.id), day) <= options.pieceRest).length * 120;
      return { outfit, score, index, top };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const pick = scored[0];
    days[day] = pick.outfit.id;
    lastUsed.set(pick.outfit.id, day);
    for (const id of pick.outfit.garmentIds) { pieceUses.set(id, (pieceUses.get(id) || 0) + 1); touch(id, day); }
    previousTop = pick.top || null;
  }
  return days;
}

// Checks a plan and lists days that break the rest rule.
export function planRepeats(days, restDays = 7) {
  const seen = new Map();
  const repeats = [];
  for (const day of Object.keys(days).sort()) {
    const id = days[day];
    if (seen.has(id) && daysBetween(seen.get(id), day) < restDays) repeats.push(day);
    seen.set(id, day);
  }
  return repeats;
}

// Every piece needed for the planned days between from and to, grouped by
// category, with how many days each is worn.
export function packingList({ days = {}, outfits = [], items = [], from, to }) {
  const outfitsById = new Map(outfits.map((outfit) => [outfit.id, outfit]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const counts = new Map();
  for (const [day, id] of Object.entries(days)) {
    if (day < from || day > to) continue;
    for (const pieceId of outfitsById.get(id)?.garmentIds || []) {
      if (itemsById.has(pieceId)) counts.set(pieceId, (counts.get(pieceId) || 0) + 1);
    }
  }
  return [...counts].map(([id, count]) => ({ item: itemsById.get(id), count })).sort((a, b) => b.count - a.count);
}

export function normalizePlan(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const days = {};
  for (const [day, id] of Object.entries(input.days && typeof input.days === "object" ? input.days : {})) {
    if (isDay(day) && typeof id === "string" && /^[\w-]{1,80}$/.test(id)) days[day] = id;
  }
  const kept = Object.keys(days).sort().slice(-400);
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const workDays = Array.isArray(settings.workDays) ? [...new Set(settings.workDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : DEFAULT_PLAN_SETTINGS.workDays;
  const restDays = Number.isInteger(settings.restDays) && settings.restDays >= 0 && settings.restDays <= 30 ? settings.restDays : DEFAULT_PLAN_SETTINGS.restDays;
  const trips = (Array.isArray(input.trips) ? input.trips : [])
    .filter((trip) => trip && isDay(trip.from) && isDay(trip.to) && trip.from <= trip.to)
    .slice(0, 20)
    .map((trip) => ({
      id: (typeof trip.id === "string" && trip.id.trim().slice(0, 40)) || `${trip.from}-${trip.to}`,
      name: (typeof trip.name === "string" && trip.name.trim().slice(0, 60)) || "Trip",
      from: trip.from,
      to: trip.to,
    }));
  const occasions = {};
  for (const [day, id] of Object.entries(input.occasions && typeof input.occasions === "object" ? input.occasions : {})) {
    if (isDay(day) && OCCASIONS[id]) occasions[day] = id;
  }
  const lockedDays = [...new Set((Array.isArray(input.lockedDays) ? input.lockedDays : []).filter((day) => isDay(day) && days[day]))].sort().slice(-400);
  const cleanTimestamps = (map, validKey) => {
    const out = {};
    for (const [k, at] of Object.entries(map && typeof map === "object" ? map : {})) {
      if (validKey(k) && typeof at === "string" && at) out[k] = at;
    }
    return out;
  };
  const removedDays = cleanTimestamps(input.removedDays, isDay);
  const removedTrips = cleanTimestamps(input.removedTrips, (k) => typeof k === "string" && k.trim().length > 0 && k.length <= 40);
  const removedOccasions = cleanTimestamps(input.removedOccasions, isDay);
  return {
    days: Object.fromEntries(kept.map((day) => [day, days[day]])),
    occasions: Object.fromEntries(Object.keys(occasions).sort().slice(-400).map((day) => [day, occasions[day]])),
    lockedDays,
    settings: { workDays, restDays, mixForgotten: settings.mixForgotten !== false, pieceRest: Number.isInteger(settings.pieceRest) && settings.pieceRest >= 0 && settings.pieceRest <= 14 ? settings.pieceRest : DEFAULT_PLAN_SETTINGS.pieceRest },
    trips,
    ...(Object.keys(removedDays).length ? { removedDays } : {}),
    ...(Object.keys(removedTrips).length ? { removedTrips } : {}),
    ...(Object.keys(removedOccasions).length ? { removedOccasions } : {}),
    updatedAt: new Date().toISOString(),
  };
}

// What was worn on each day: { "2026-11-18": { outfitIds: [...], pieceIds: [...] } }.
export function wornByDay(outfits = [], items = []) {
  const days = {};
  const at = (day) => (days[day] ||= { outfitIds: [], pieceIds: [] });
  for (const outfit of outfits) for (const day of outfit.wornDates || []) at(day).outfitIds.push(outfit.id);
  for (const item of items) for (const day of item.wornDates || []) at(day).pieceIds.push(item.id);
  return days;
}

// Closet summary metrics for the Insights sheet: value, average cost per wear,
// utilization in the last N days, most worn heroes, best value, and pieces
// that haven't been worn in a while.
export function closetInsights(items = [], { today = dayString(), days = 60 } = {}) {
  const totalPieces = items.length;
  let totalWears = 0;
  let totalValue = 0;
  let pricedCount = 0;
  let cpwSum = 0;
  let wornRecentlyCount = 0;
  const byPart = {};

  for (const item of items) {
    const wears = wearCount(item);
    totalWears += wears;
    const price = Number(item?.price);
    if (Number.isFinite(price) && price > 0) {
      totalValue += price;
      pricedCount += 1;
      cpwSum += price / Math.max(1, wears);
    }
    const last = lastWorn(item);
    if (last && daysBetween(last, today) <= days) wornRecentlyCount += 1;
    const part = item?.part || "upperbody";
    byPart[part] = (byPart[part] || 0) + 1;
  }

  const mostWorn = [...items]
    .map((item) => ({ item, wears: wearCount(item) }))
    .filter(({ wears }) => wears > 0)
    .sort((a, b) => b.wears - a.wears || a.item.name.localeCompare(b.item.name))
    .slice(0, 5);

  const bestValue = [...items]
    .map((item) => ({ item, cpw: costPerWear(item), wears: wearCount(item) }))
    .filter(({ cpw, wears }) => cpw !== null && wears > 0)
    .sort((a, b) => a.cpw - b.cpw || b.wears - a.wears)
    .slice(0, 5);

  const needsLove = [...items]
    .map((item) => ({ item, wears: wearCount(item), idle: idleDays(item, today) }))
    .filter(({ wears, idle }) => wears === 0 || (idle !== null && idle >= days))
    .sort((a, b) => (a.wears - b.wears) || ((b.idle ?? 999) - (a.idle ?? 999)))
    .slice(0, 5);

  return {
    totalPieces,
    totalWears,
    totalValue: Math.round(totalValue * 100) / 100,
    pricedCount,
    avgCostPerWear: pricedCount ? Math.round((cpwSum / pricedCount) * 100) / 100 : null,
    wornRecentlyCount,
    utilizationPct: totalPieces ? Math.round((wornRecentlyCount / totalPieces) * 100) : 0,
    mostWorn,
    bestValue,
    needsLove,
    byPart,
  };
}
