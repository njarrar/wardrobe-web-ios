// Reading colors from a piece's picture, and sorting and naming them.
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
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
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
}

export function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

export function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
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
