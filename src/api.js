// Talks to the wardrobe server. In the browser the server is the page's own
// origin; in the iOS app the person enters its address once (for example the
// Synology NAS on the home network, or a public HTTPS address).
import { isLocalMode, localApi } from "./local/mode.js";
import { cloudStore } from "./local/plugin.js";

const SERVER_KEY = "wardrobe-server-url";
const TOKEN_KEY = "wardrobe-token";
export const AUTH_EVENT = "wardrobe:auth-required";
// Sent when Settings switches the AI or changes its key.
export const AI_CHANGED_EVENT = "wardrobe:ai-changed";

function read(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

// Accepts what people actually type ("192.168.1.20:4173", "nas.local:4173/",
// "https://wardrobe.example.synology.me") and turns it into a base URL.
// Returns "" on malformed URLs or non-http(s) schemes.
export function normalizeServerUrl(value = "") {
  let text = String(value).trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

export function serverUrl() {
  return read(SERVER_KEY).replace(/\/+$/, "");
}

// On iPhone and iPad the server token lives in the Keychain, not in the
// page's storage. It is read once at start and kept in memory. keychainActive
// stays true when the native Keychain is available so transient Keychain
// errors never silently downgrade secrets to plaintext localStorage.
const TOKEN_SECRET = "server-token";
let keychainActive = false;
let keychainToken = null;

export async function loadSavedToken() {
  const vault = cloudStore();
  if (!vault) return;
  try {
    let value = (await vault.getSecret({ key: TOKEN_SECRET })).value || "";
    // The Keychain answered, so from now on secrets never fall back to
    // plain page storage, even if a later Keychain call fails.
    keychainActive = true;
    // Only move a legacy token over when the Keychain is empty; never
    // overwrite a newer iCloud Keychain token.
    const old = read(TOKEN_KEY);
    if (!value && old) {
      await vault.setSecret({ key: TOKEN_SECRET, value: old });
      value = old;
      write(TOKEN_KEY, "");
    } else if (value && old) {
      write(TOKEN_KEY, "");
    }
    keychainToken = value;
  } catch {
    // No Keychain plugin (a browser posing as the app): use page storage.
    if (!keychainActive) return;
    if (keychainToken === null) keychainToken = "";
  }
}

async function saveToken(value) {
  if (!keychainActive) { write(TOKEN_KEY, value); return; }
  await cloudStore().setSecret({ key: TOKEN_SECRET, value: value || null });
  keychainToken = value;
}

export function accessToken() {
  return keychainActive ? (keychainToken || "") : read(TOKEN_KEY);
}

// Image tags cannot send headers, so image links carry a short-lived image
// key from the server instead of the token. Servers older than 2.3 have no
// image keys and still take the token in the link.
let images = { params: "", expires: 0 };
let imageKeyInflight = null;

function resetImageKey() {
  images = { params: "", expires: 0 };
  imageKeyInflight = null;
}

// Both wait until the token is stored, so a reload right after is safe.
export async function saveConnection({ server, token }) {
  resetImageKey();
  if (server !== undefined) write(SERVER_KEY, normalizeServerUrl(server));
  if (token !== undefined) await saveToken(token.trim());
}

export async function forgetConnection({ keepServer = false } = {}) {
  resetImageKey();
  if (!keepServer) write(SERVER_KEY, "");
  await saveToken("");
}

export function needsServerUrl() {
  return isNativeApp() && !serverUrl() && !isLocalMode();
}

// A short, human label for where the closet lives.
export function connectionLabel() {
  if (isLocalMode()) return localApi().store.kind === "icloud" ? "iCloud" : "This device";
  const base = serverUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  try { return new URL(base).host; } catch { return base; }
}

export function apiUrl(path) {
  return `${serverUrl()}${path}`;
}

export async function ensureImageKey() {
  if (isLocalMode()) return;
  const token = accessToken();
  if (!token) { resetImageKey(); return; }
  // Renew once less than two hours are left, so open screens never hold a
  // key that is about to run out.
  if (images.expires - 2 * 60 * 60 > Date.now() / 1000) return;
  if (imageKeyInflight) return imageKeyInflight;
  imageKeyInflight = (async () => {
    try {
      const response = await apiFetch("/api/import/image-key", { cache: "no-store" });
      if (response.status === 404) {
        images = { params: `token=${encodeURIComponent(token)}`, expires: Infinity };
        return;
      }
      if (!response.ok) return;
      const value = await response.json().catch(() => null);
      if (!value || typeof value !== "object") return;
      if (value.key) {
        images = { params: `k=${value.key}&e=${value.expires}`, expires: value.expires };
      } else if (value.key === null) {
        images = { params: "", expires: Infinity };
      }
    } catch { /* images will ask again on the next load */ }
    finally { imageKeyInflight = null; }
  })();
  return imageKeyInflight;
}

export function assetUrl(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/api/")) return path;
  if (isLocalMode()) return localApi().assetUrl(path);
  const url = apiUrl(path);
  return images.params ? `${url}${url.includes("?") ? "&" : "?"}${images.params}` : url;
}

export async function apiFetch(path, options = {}) {
  if (isLocalMode()) return localApi().handle(path, options);
  const token = accessToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_EVENT));
  return response;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

// Checks an address and token before they are saved, so the connect screen
// can say exactly what is wrong instead of failing after a reload.
// Resolves to { ok, reason?, server?, config? }.
export async function testConnection({ server = "", token = "" } = {}) {
  if (isLocalMode() && !server) {
    try {
      const healthResponse = await apiFetch("/api/health");
      const configResponse = await apiFetch("/api/import/config");
      if (!healthResponse.ok || !configResponse.ok) return { ok: false, reason: "server" };
      const health = await healthResponse.json().catch(() => null);
      const config = await configResponse.json().catch(() => null);
      return { ok: true, server: health, config };
    } catch {
      return { ok: false, reason: "server" };
    }
  }
  const base = server ? normalizeServerUrl(server) : "";
  if (server && !base) return { ok: false, reason: "unreachable" };
  const trimmedToken = token.trim();
  const headers = trimmedToken ? { Authorization: `Bearer ${trimmedToken}` } : {};
  let health = null;
  try {
    const response = await fetchWithTimeout(`${base}/api/health`);
    if (response.ok) health = await response.json().catch(() => null);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  try {
    const response = await fetchWithTimeout(`${base}/api/import/config`, { headers });
    if (response.status === 401) return { ok: false, reason: "token", server: health };
    if (!response.ok) return { ok: false, reason: "server", server: health };
    const config = await response.json().catch(() => null);
    if (!config || typeof config !== "object" || (health?.app !== "wardrobe" && typeof config.ready !== "boolean")) {
      return { ok: false, reason: "server", server: health };
    }
    return { ok: true, server: health, config };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
