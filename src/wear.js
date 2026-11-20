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
  if (!response.ok) throw Object.assign(new Error(value.error || failure), { status: response.status });
  return value;
}

export function patchItem(id, changes) {
  return sendJson(`/api/import/wardrobe/${encodeURIComponent(id)}`, "PATCH", changes, t("Could not save your changes."));
}

export function patchOutfit(id, changes) {
  return sendJson(`/api/import/outfits/${encodeURIComponent(id)}`, "PATCH", changes, t("Could not save the outfit."));
}

// Logs (or with undo, takes back) a day an outfit was worn, on the outfit and
// sequentially on every piece in it (avoiding concurrent library.json rewrites).
// Retries transient failures once and reports any failed piece IDs cleanly.
export async function wearOutfit(outfit, { day = dayString(), undo = false } = {}) {
  const change = undo ? { unwear: day } : { wear: day };
  const saved = await patchOutfit(outfit.id, change);
  const pieces = [];
  const failedIds = [];
  for (const id of outfit.garmentIds || []) {
    try {
      pieces.push(await patchItem(id, change));
    } catch (error) {
      if (error?.status === 404) continue;
      try {
        pieces.push(await patchItem(id, change));
      } catch {
        failedIds.push(id);
      }
    }
  }
  return {
    outfit: saved,
    pieces,
    ...(failedIds.length ? { failedIds, warning: t("Could not save your changes.") } : {}),
  };
}

export function wearPiece(id, { day = dayString(), undo = false } = {}) {
  return patchItem(id, undo ? { unwear: day } : { wear: day });
}

export function wornOn(record, day = dayString()) {
  return Array.isArray(record?.wornDates) && record.wornDates.includes(day);
}
