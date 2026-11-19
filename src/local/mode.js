// Server mode or local mode (iCloud on iPhone and iPad). Local mode keeps
// the closet with the person and needs no server at all.
import { createLocalApi } from "./backend.js";
import { createNativeStore, createWebStore } from "./store.js";

const MODE_KEY = "wardrobe-closet-mode";
let api = null;

export function closetMode() {
  try { return localStorage.getItem(MODE_KEY) === "local" ? "local" : "server"; } catch { return "server"; }
}

export function isLocalMode() {
  return closetMode() === "local" && Boolean(api);
}

export function localApi() {
  return api;
}

// Offered on iPhone and iPad, where the files sync through iCloud.
export function canUseLocalMode() {
  return globalThis.Capacitor?.getPlatform?.() === "ios" || closetMode() === "local";
}

export function setClosetMode(mode) {
  try {
    if (mode === "local") localStorage.setItem(MODE_KEY, "local");
    else localStorage.removeItem(MODE_KEY);
  } catch { /* storage unavailable */ }
}

// Sends AI requests through the phone app's own HTTP, so the AI companies'
// web rules (CORS) do not apply. Falls back to fetch in a browser.
export async function nativeFetch(input, init = {}) {
  const http = globalThis.Capacitor?.Plugins?.CapacitorHttp;
  if (!http) return fetch(input, init);
  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  let data = init.body;
  if (typeof data === "string" && /json/i.test(headers["content-type"] || "")) { try { data = JSON.parse(data); } catch { /* send as is */ } }
  const result = await http.request({ url: String(input), method: init.method || "GET", headers, data, responseType: "text" });
  const body = typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null);
  return new Response(body, { status: result.status, headers: result.headers || {} });
}

// Sent when the closet may have changed behind the app's back: iCloud
// synced, or the app came back to the front.
export const CLOSET_CHANGED_EVENT = "wardrobe:closet-changed";
let announceTimer = null;
export function announceChange(delay = 1500) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => window.dispatchEvent(new Event(CLOSET_CHANGED_EVENT)), delay);
}

async function deviceCutout(pngBytes) {
  const { cutOutPng } = await import("../cutout.js");
  return cutOutPng(pngBytes);
}

// Opens the local closet before the app draws its first screen.
export async function startLocalMode({ version } = {}) {
  if (closetMode() !== "local") return null;
  const native = globalThis.Capacitor?.isNativePlatform?.();
  const store = native ? await createNativeStore() : await createWebStore();
  api = createLocalApi({ store, version, aiFetch: native ? nativeFetch : null, cutout: native ? deviceCutout : null });
  // iCloud brought changes from another device: have the screens reload.
  store.onChange?.(() => announceChange());
  return api;
}
