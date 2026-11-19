import { apiFetch } from "./api.js";
import { dayString } from "../shared/style.mjs";
import { t } from "./i18n.js";

export async function sendJson(path, method, payload, failure) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || failure);
  return value;
}

export function patchItem(id, changes) {
  return sendJson(`/api/import/wardrobe/${encodeURIComponent(id)}`, "PATCH", changes, t("Could not save your changes."));
}

export function patchOutfit(id, changes) {
  return sendJson(`/api/import/outfits/${encodeURIComponent(id)}`, "PATCH", changes, t("Could not save the outfit."));
}

// Logs (or with undo, takes back) a day an outfit was worn, on the outfit and
// on every piece in it. Resolves with the saved outfit and pieces.
export async function wearOutfit(outfit, { day = dayString(), undo = false } = {}) {
  const change = undo ? { unwear: day } : { wear: day };
  const saved = await patchOutfit(outfit.id, change);
  const pieces = await Promise.all((outfit.garmentIds || []).map((id) => patchItem(id, change).catch(() => null)));
  return { outfit: saved, pieces: pieces.filter(Boolean) };
}

export function wearPiece(id, { day = dayString(), undo = false } = {}) {
  return patchItem(id, undo ? { unwear: day } : { wear: day });
}

export function wornOn(record, day = dayString()) {
  return Array.isArray(record?.wornDates) && record.wornDates.includes(day);
}
