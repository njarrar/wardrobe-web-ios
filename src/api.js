// Talks to the wardrobe server. In the browser the server is the page's own
// origin; in the iOS app the person enters its address once.
const SERVER_KEY = "wardrobe-server-url";
const TOKEN_KEY = "wardrobe-token";
export const AUTH_EVENT = "wardrobe:auth-required";

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

export function serverUrl() {
  return read(SERVER_KEY).replace(/\/+$/, "");
}

export function accessToken() {
  return read(TOKEN_KEY);
}

export function saveConnection({ server, token }) {
  if (server !== undefined) write(SERVER_KEY, server.trim().replace(/\/+$/, ""));
  if (token !== undefined) write(TOKEN_KEY, token.trim());
}

export function needsServerUrl() {
  return isNativeApp() && !serverUrl();
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
