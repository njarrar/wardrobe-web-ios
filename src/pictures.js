// Small picture helpers that run in the browser or phone app.
import { shapeSvg } from "../shared/shapes.mjs";
import { t } from "./i18n.js";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("Could not open the picture.")));
    image.src = src;
  });
}

export function canvasToDataUrl(canvas) {
  return canvas.toDataURL("image/png");
}

// Draws a starter piece (shared/shapes.mjs) in the chosen color as a PNG.
export async function drawnPiecePng(shape, color, size = 600) {
  const svg = shapeSvg(shape, color);
  if (!svg) throw new Error(t("Unknown piece"));
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d").drawImage(image, 0, 0, size, size);
  return canvasToDataUrl(canvas);
}
