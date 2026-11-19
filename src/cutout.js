// Picture fixes for a saved piece: Apple's on-device cutout (iPhone and iPad
// with iOS 17 or later) and the hand brush. Both run on the device; only the
// finished PNG goes to the wardrobe server.
import { apiFetch, assetUrl } from "./api.js";
import { loadImage } from "./pictures.js";
import { sendJson } from "./wear.js";
import { t } from "./i18n.js";

let plugin = null;
let available = null;

// The phone app's bridge adds window.Capacitor; web browsers have none.
function Cutout() {
  plugin ??= globalThis.Capacitor?.registerPlugin?.("Cutout") || null;
  if (!plugin) throw new Error("Not in the phone app");
  return plugin;
}

export async function canCutOutOnDevice() {
  if (available !== null) return available;
  if (globalThis.Capacitor?.getPlatform?.() !== "ios") { available = false; return available; }
  try { available = Boolean((await Cutout().isAvailable()).available); } catch { available = false; }
  return available;
}

// Loads a piece's picture without tainting the canvas.
export async function loadPiecePicture(path) {
  const response = path?.startsWith("/api/") ? await apiFetch(path) : await fetch(assetUrl(path));
  if (!response.ok) throw new Error(t("Could not open the picture."));
  const url = URL.createObjectURL(await response.blob());
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// Puts a picture on a white square, which is what the cutout reads best.
function onWhite(image, edge = 1600) {
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Centers a cut piece on a clear square with a small margin, like imports.
export function frameOnSquare(source, size = 1200, margin = 0.08) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const room = size * (1 - margin * 2);
  const scale = Math.min(room / width, room / height);
  canvas.getContext("2d").drawImage(source, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
  return canvas.toDataURL("image/png");
}

export async function cutOutOnDevice(item) {
  const image = await loadPiecePicture(item.image);
  const result = await Cutout().cutOut({ image: onWhite(image) });
  if (!result?.image) throw new Error(t("The cut found nothing. Try Fix edges instead."));
  return frameOnSquare(await loadImage(result.image));
}

export function savePiecePicture(id, imageDataUrl) {
  return sendJson(`/api/import/wardrobe/${encodeURIComponent(id)}/image`, "PUT", { imageDataUrl }, t("Could not save the picture."));
}
