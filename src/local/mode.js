// Server mode or local mode (iCloud on iPhone and iPad). Local mode keeps
// the closet with the person and needs no server at all.
// The closet code and the AI libraries load only when this mode is on, so
// a phone that talks to a server starts faster.

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
  const { signal } = init;
  if (signal?.aborted) throw signal.reason || new DOMException("The operation was aborted.", "AbortError");
  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  let data = init.body;
  if (typeof data === "string" && /json/i.test(headers["content-type"] || "")) { try { data = JSON.parse(data); } catch { /* send as is */ } }
  // Without these the phone waits on a dead connection with no end.
  const request = http.request({ url: String(input), method: init.method || "GET", headers, data, responseType: "text", connectTimeout: 30000, readTimeout: 120000 });
  let result;
  if (signal) {
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason || new DOMException("The operation was aborted.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    request.catch(() => {});
    try { result = await Promise.race([request, aborted]); } finally { signal.removeEventListener("abort", onAbort); }
  } else {
    result = await request;
  }
  const status = Number(result?.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new TypeError("Network request failed");
  }
  const nullBody = status === 204 || status === 205 || status === 304;
  const body = nullBody ? null : typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null);
  return new Response(body, { status, headers: result.headers || {} });
}

// Sent when the closet may have changed behind the app's back: iCloud
// synced, or the app came back to the front.
export const CLOSET_CHANGED_EVENT = "wardrobe:closet-changed";
let announceTimer = null;
export function announceChange(delay = 1500) {
  if (typeof window === "undefined") return;
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
  const [{ createLocalApi }, { createNativeStore, createWebStore }] = await Promise.all([import("./backend.js"), import("./store.js")]);
  const store = native ? await createNativeStore() : await createWebStore();
  api = createLocalApi({ store, version, aiFetch: native ? nativeFetch : null, cutout: native ? deviceCutout : null });
  // iCloud brought changes from another device: have the screens reload.
  store.onChange?.(() => announceChange());
  return api;
}
