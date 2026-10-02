// Talks to the wardrobe server. In the browser the server is the page's own
// origin; in the iOS app the person enters its address once (for example the
// Synology NAS on the home network, or a public HTTPS address).
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
export function normalizeServerUrl(value = "") {
  let text = String(value).trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return text.replace(/\/+$/, "");
  }
}

export function serverUrl() {
  return read(SERVER_KEY).replace(/\/+$/, "");
}

export function accessToken() {
  return read(TOKEN_KEY);
}

export function saveConnection({ server, token }) {
  if (server !== undefined) write(SERVER_KEY, normalizeServerUrl(server));
  if (token !== undefined) write(TOKEN_KEY, token.trim());
}

export function forgetConnection({ keepServer = false } = {}) {
  if (!keepServer) write(SERVER_KEY, "");
  write(TOKEN_KEY, "");
}

export function needsServerUrl() {
  return isNativeApp() && !serverUrl();
}

// A short, human label for where the closet lives.
export function connectionLabel() {
  const base = serverUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  try { return new URL(base).host; } catch { return base; }
}

export function apiUrl(path) {
  return `${serverUrl()}${path}`;
}

// Image tags cannot send headers, so API images carry the token in the URL.
export function assetUrl(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/api/")) return path;
  const token = accessToken();
  const url = apiUrl(path);
  return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
}

export async function apiFetch(path, options = {}) {
  const token = accessToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_EVENT));
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
  const base = server ? normalizeServerUrl(server) : "";
  const headers = token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
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
    return { ok: true, server: health, config: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
