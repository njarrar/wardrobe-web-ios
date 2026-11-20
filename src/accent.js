// The app's accent color and appearance (auto, light, dark). Kept on this
// device. "rust" and "auto" are what the app ships with.

const KEY = "wardrobe-accent";
const THEME_KEY = "wardrobe-theme";

// [light mode (WCAG AA >= 4.5:1 on --bg), dark mode]
export const ACCENTS = [
  { id: "rust", label: "Rust", colors: ["#a8441d", "#ef8354"] },
  { id: "blue", label: "Blue", colors: ["#2553ad", "#7da6f5"] },
  { id: "green", label: "Green", colors: ["#226b46", "#6cc596"] },
  { id: "plum", label: "Plum", colors: ["#7b3380", "#d08bd6"] },
  { id: "rose", label: "Rose", colors: ["#ad2b51", "#f2849f"] },
  { id: "gold", label: "Gold", colors: ["#855908", "#e0b85a"] },
  { id: "ink", label: "Ink", colors: ["#3a3a3a", "#d4d2cc"] },
];

export const THEMES = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function accent() {
  try { const saved = localStorage.getItem(KEY); return ACCENTS.some((entry) => entry.id === saved) ? saved : "rust"; } catch { return "rust"; }
}

export function theme() {
  try { const saved = localStorage.getItem(THEME_KEY); return THEMES.some((entry) => entry.id === saved) ? saved : "auto"; } catch { return "auto"; }
}

function isDarkNow(mode = theme()) {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

function rgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

let watching = false;

export function applyTheme(mode = theme()) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  else delete root.dataset.theme;
  applyAccent(accent(), mode);
}

export function setTheme(mode) {
  const next = THEMES.some((entry) => entry.id === mode) ? mode : "auto";
  try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  applyTheme(next);
}

// Sets the CSS colors for the chosen accent, in light and dark mode.
export function applyAccent(id = accent(), mode = theme()) {
  if (typeof document === "undefined") return;
  const entry = ACCENTS.find((option) => option.id === id) || ACCENTS[0];
  const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  const dark = isDarkNow(mode);
  const style = document.documentElement.style;
  style.setProperty("--on-accent", dark ? "#111111" : "#ffffff");
  if (entry.id === "rust") {
    for (const name of ["--accent", "--accent-soft", "--focus"]) style.removeProperty(name);
  } else {
    const color = entry.colors[dark ? 1 : 0];
    style.setProperty("--accent", color);
    style.setProperty("--accent-soft", rgba(color, dark ? 0.16 : 0.12));
    style.setProperty("--focus", `0 0 0 3px ${rgba(color, dark ? 0.4 : 0.35)}`);
  }
  if (!watching && darkQuery?.addEventListener) { watching = true; darkQuery.addEventListener("change", () => applyAccent()); }
}

export function setAccent(id) {
  const entry = ACCENTS.find((option) => option.id === id);
  if (!entry) return;
  try { if (entry.id === "rust") localStorage.removeItem(KEY); else localStorage.setItem(KEY, entry.id); } catch { /* storage unavailable */ }
  applyAccent(entry.id);
}
