import { useEffect, useState } from "react";
import { dayString, isNeutral, itemWarmth } from "../shared/style.mjs";
import { isModestWear } from "../shared/pairing.mjs";

export const TYPES = [
  { id: "all", label: "All" },
  { id: "upperbody", label: "Tops", singular: "Top" },
  { id: "wholebody_up", label: "Jackets", singular: "Jacket" },
  { id: "lowerbody", label: "Bottoms", singular: "Bottom" },
  { id: "accessories_up", label: "Accessories", singular: "Accessory" },
  { id: "shoes", label: "Shoes", singular: "Shoes" },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
export const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

// Plain color words, so "blue" or "beige" finds pieces by their hex color.
export const COLOR_FAMILIES = [
  { id: "black", label: "Black", swatch: "#1f1f1f" },
  { id: "grey", label: "Grey", swatch: "#8d8d8d" },
  { id: "white", label: "White", swatch: "#f1efea" },
  { id: "beige", label: "Beige", swatch: "#d6c4a3" },
  { id: "brown", label: "Brown", swatch: "#7a5134" },
  { id: "red", label: "Red", swatch: "#c23b32" },
  { id: "orange", label: "Orange", swatch: "#e0823a" },
  { id: "yellow", label: "Yellow", swatch: "#e6c34a" },
  { id: "green", label: "Green", swatch: "#5f7a45" },
  { id: "blue", label: "Blue", swatch: "#34528f" },
  { id: "purple", label: "Purple", swatch: "#7a4e98" },
  { id: "pink", label: "Pink", swatch: "#e79bb4" },
];

export const COLOR_FAMILY_MAP = Object.fromEntries(COLOR_FAMILIES.map((family) => [family.id, family]));

// Smart groups built from what the AI (or you) said about each piece.
export const GROUPS = [
  { id: "winter", label: "Winter", test: (item) => item.seasons?.includes("winter") || (!item.seasons && itemWarmth(item) >= 4) },
  { id: "summer", label: "Summer", test: (item) => item.seasons?.includes("summer") || (!item.seasons && itemWarmth(item) <= 2) },
  { id: "spring-fall", label: "Spring and fall", test: (item) => item.seasons?.includes("spring") || item.seasons?.includes("fall") },
  { id: "work", label: "Work", test: (item) => item.formality === "smart" || item.formality === "formal" },
  { id: "casual", label: "Casual", test: (item) => item.formality === "casual" },
  { id: "neutrals", label: "Neutrals", test: (item) => isNeutral(item.color) },
  { id: "modest", label: "Modest wear", test: isModestWear },
];

export const GROUP_MAP = Object.fromEntries(GROUPS.map((group) => [group.id, group]));
export const SEASON_LABELS = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };
export const DRESS_LABELS = { casual: "Casual", smart: "Smart", formal: "Formal" };
export const SORTS = [
  { id: "category", label: "Category" },
  { id: "recent", label: "Recently added" },
  { id: "color", label: "Color" },
  { id: "name", label: "Name" },
];

export const needsSorting = (item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality;

export function pieceLabel(piece, tr) {
  const name = typeof piece?.name === "string" ? piece.name.trim() : "";
  if (name) return name;
  const fallback = TYPE_MAP[piece?.part]?.singular || "Piece";
  return tr ? tr(fallback) : fallback;
}

export function draftFromItem(item) {
  return {
    name: item.name || "",
    part: item.part,
    color: item.color || "#9a9286",
    secondaryColor: item.secondaryColor || null,
    tags: [...(item.tags || [])],
    price: item.price ?? "",
    kind: item.kind || "",
    warmth: item.warmth || "",
    formality: item.formality || "",
    pattern: item.pattern || "",
    seasons: [...(item.seasons || [])],
  };
}

// Normalizes Latin case and Arabic orthographic variants for search matching.
export function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

export function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

export function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

export function extractPalette(image) {
  try {
    if (!image || !image.naturalWidth || !image.naturalHeight) return [];
    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map();

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha < 72) continue;

      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
      const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
      current.red += red;
      current.green += green;
      current.blue += blue;
      current.count += 1;
      buckets.set(key, current);
    }

    const ranked = [...buckets.values()]
      .map((bucket) => ({
        red: Math.round(bucket.red / bucket.count),
        green: Math.round(bucket.green / bucket.count),
        blue: Math.round(bucket.blue / bucket.count),
        count: bucket.count,
      }))
      .sort((a, b) => b.count - a.count);

    const selected = [];
    for (const color of ranked) {
      if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
      if (selected.length === 5) break;
    }

    return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
  } catch {
    return [];
  }
}

export function buildSamplingCanvas(image) {
  try {
    if (!image || !image.naturalWidth || !image.naturalHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    // Probe one pixel to verify canvas is not CORS-tainted before returning.
    context.getImageData(0, 0, 1, 1);
    return canvas;
  } catch {
    return null;
  }
}

export function sampleImageColor(image, canvas, event) {
  try {
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return null;
    const bounds = image.getBoundingClientRect();
    const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    if (!scale) return null;
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const offsetX = (bounds.width - renderedWidth) / 2;
    const offsetY = (bounds.height - renderedHeight) / 2;
    const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
    const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

    if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    for (let radius = 0; radius <= 18; radius += 2) {
      const startX = Math.max(0, imageX - radius);
      const startY = Math.max(0, imageY - radius);
      const width = Math.min(canvas.width - startX, (radius * 2) + 1);
      const height = Math.min(canvas.height - startY, (radius * 2) + 1);
      const data = context.getImageData(startX, startY, width, height).data;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function hexToHue(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return { hue: 999, sat: 0, light: 0 };
  const value = parseInt(match[1], 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { hue: 999, sat: 0, light };
  const sat = delta / (1 - Math.abs((2 * light) - 1));
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = ((blue - red) / delta) + 2;
  else hue = ((red - green) / delta) + 4;
  return { hue: (hue * 60 + 360) % 360, sat, light };
}

// Neutrals (low saturation) go last, dark to light; colors follow the wheel.
export function colorSortKey(item) {
  const { hue, sat, light } = hexToHue(item.color);
  return sat < 0.14 ? 1000 + (light * 100) : hue;
}

export function colorFamily(hex) {
  const { hue, sat, light } = hexToHue(hex);
  if (!/^#?[0-9a-f]{6}$/i.test(hex || "")) return null;
  if (light < 0.16) return "black";
  if (light > 0.9) return "white";
  if (sat < 0.14) return light > 0.75 ? "white" : "grey";
  if (hue >= 15 && hue < 50) {
    if (light < 0.45) return "brown";
    if (sat < 0.55 || light > 0.7) return "beige";
    return "orange";
  }
  if (hue >= 50 && hue < 70) return sat < 0.4 ? "beige" : "yellow";
  if (hue >= 70 && hue < 170) return "green";
  if (hue >= 170 && hue < 255) return "blue";
  if (hue >= 255 && hue < 295) return "purple";
  if (hue >= 295 && hue < 345) return light > 0.6 ? "pink" : "purple";
  return light > 0.72 ? "pink" : light < 0.3 ? "brown" : "red";
}

export function itemFamilies(item) {
  return [...new Set([item.color, item.secondaryColor].map(colorFamily).filter(Boolean))];
}

// Tracks today's date string and refreshes cleanly across midnight or app resume.
export function useToday() {
  const [today, setToday] = useState(dayString);

  useEffect(() => {
    const sync = () => {
      const now = dayString();
      setToday((current) => (current === now ? current : now));
    };
    const scheduleMidnight = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
      return setTimeout(() => {
        sync();
        timerId = scheduleMidnight();
      }, Math.max(1000, next.getTime() - now.getTime()));
    };
    let timerId = scheduleMidnight();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
