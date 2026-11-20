// What a piece goes with: a short note for its page and the closet pieces
// that pair best with it. No AI. Pure functions.

import { colorHarmony, hexToHsl, idleDays, isNeutral, itemWarmth } from "./style.mjs";
import { isOnePiece } from "./make-outfit.mjs";

export const PATTERNS = ["solid", "striped", "checked", "dotted", "floral", "printed", "textured"];
export const PATTERN_LABELS = { solid: "Solid", striped: "Striped", checked: "Checked", dotted: "Dotted", floral: "Floral", printed: "Printed", textured: "Textured" };
const DRESSY = { casual: 0, smart: 1, formal: 2 };

// A pattern that draws the eye. Solid and textured cloth do not.
export function isPatterned(item) {
  return Boolean(item?.pattern) && item.pattern !== "solid" && item.pattern !== "textured";
}

const HUES = [[15, "red"], [45, "orange"], [70, "yellow"], [165, "green"], [200, "teal"], [255, "blue"], [290, "purple"], [345, "pink"], [360, "red"]];

// "blue" for #2f5fd0. Neutrals have no place on the wheel, so they give "".
export function colorName(hex) {
  if (isNeutral(hex)) return "";
  const hsl = hexToHsl(hex);
  if (!hsl) return "";
  return (HUES.find(([limit]) => hsl.hue < limit) || HUES[0])[1];
}

function nameAt(hue) {
  const turn = ((hue % 360) + 360) % 360;
  return (HUES.find(([limit]) => turn < limit) || HUES[0])[1];
}

// Human-friendly color name for display (covers both neutrals and chromatic hues).
export function humanColorName(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return "";
  const { hue, sat, light } = hsl;
  if (light < 0.16) return "Black";
  if (light > 0.9) return "White";
  if (sat < 0.16) return light > 0.74 ? "Off-white" : "Grey";
  if (hue >= 18 && hue < 55 && (sat < 0.5 || light < 0.42)) {
    if (light < 0.36) return "Brown";
    return light > 0.68 ? "Beige" : "Camel";
  }
  if (hue >= 200 && hue < 245 && light < 0.36) return "Navy";
  const name = colorName(hex);
  return name ? name[0].toUpperCase() + name.slice(1) : "Neutral";
}

// Up to three plain lines about how to wear a piece, as [text, values] pairs
// the app shows in its own language.
export function pairingNote(item) {
  const notes = [];
  const own = item?.color ? colorName(item.color) : "";
  if (!item?.color) { /* no color known */ }
  else if (!own) notes.push(["A neutral color. It goes with any other color."]);
  else {
    const { hue } = hexToHsl(item.color);
    const near = [hue + 40, hue - 40].map(nameAt).find((name) => name !== own) || nameAt(hue + 60);
    const across = nameAt(hue + 180);
    notes.push(near === across
      ? ["Wear it with neutrals, or with {a}.", { a: across }]
      : ["Wear it with neutrals. For more color, try {a} next to it or {b} across from it.", { a: near, b: across }]);
  }
  if (isPatterned(item)) notes.push(["It has a pattern, so keep the pieces around it plain."]);
  if (item?.formality === "formal") notes.push(["Dressy. Pair it with smart or formal pieces."]);
  else if (item?.formality === "casual" && itemWarmth(item) >= 4) notes.push(["Warm and relaxed. Good as the top layer on a cold day."]);
  return notes.slice(0, 3);
}

// Two or three words for a closet tile.
export function tileNote(item) {
  if (!item?.color) return "";
  if (isPatterned(item)) return "Keep the rest plain";
  return colorName(item.color) ? "Best with neutrals" : "Goes with any color";
}

// Modest wear, by kind, name or tag.
export function isModestWear(item) {
  return /abaya|hijab|thobe|kandura|dishdasha|shemagh|ghutra|bisht|jalabiya|kaftan|modest/.test(`${item?.kind || ""} ${item?.name || ""} ${(item?.tags || []).join(" ")}`.toLowerCase());
}

// Closet pieces from other categories that pair best with this one, best
// first, at most two per category.
export function goesWith(item, items = [], { limit = 6, today } = {}) {
  if (!item) return [];
  const whole = isOnePiece(item);
  const scored = items
    .filter((other) => other.id !== item.id && other.part !== item.part && !(whole && other.part === "lowerbody"))
    .map((other) => {
      let score = item.color && other.color ? colorHarmony([item.color, other.color]).score : 70;
      const levels = [DRESSY[item.formality], DRESSY[other.formality]];
      if (levels.every((level) => level !== undefined)) score -= Math.abs(levels[0] - levels[1]) * 12;
      if (other.part !== "wholebody_up" && item.part !== "wholebody_up") score -= Math.abs(itemWarmth(item) - itemWarmth(other)) * 3;
      if (isPatterned(item) && isPatterned(other)) score -= 25;
      score += Math.min(60, idleDays(other, today) ?? 0) / 20;
      return { other, score };
    })
    .sort((a, b) => b.score - a.score);
  const perPart = new Map();
  const picked = [];
  for (const { other } of scored) {
    const count = perPart.get(other.part) || 0;
    if (count >= 2) continue;
    perPart.set(other.part, count + 1);
    picked.push(other);
    if (picked.length >= limit) break;
  }
  return picked;
}
