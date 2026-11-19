// The app's accent color: the tint on buttons, marks and today's date.
// Kept on this device. "rust" is the color the app ships with.

const KEY = "wardrobe-accent";

// [light mode, dark mode]
export const ACCENTS = [
  { id: "rust", label: "Rust", colors: ["#c2562b", "#ef8354"] },
  { id: "blue", label: "Blue", colors: ["#2f62c4", "#7da6f5"] },
  { id: "green", label: "Green", colors: ["#2f7d55", "#6cc596"] },
  { id: "plum", label: "Plum", colors: ["#8a3f8f", "#d08bd6"] },
  { id: "rose", label: "Rose", colors: ["#c23b62", "#f2849f"] },
  { id: "gold", label: "Gold", colors: ["#9a6b12", "#e0b85a"] },
  { id: "ink", label: "Ink", colors: ["#3a3a3a", "#d4d2cc"] },
];

export function accent() {
  try { const saved = localStorage.getItem(KEY); return ACCENTS.some((entry) => entry.id === saved) ? saved : "rust"; } catch { return "rust"; }
}

function rgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

let watching = false;

// Sets the CSS colors for the chosen accent, in light and dark mode.
export function applyAccent(id = accent()) {
  const entry = ACCENTS.find((option) => option.id === id) || ACCENTS[0];
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
  const style = document.documentElement.style;
  if (entry.id === "rust") {
    for (const name of ["--accent", "--accent-soft", "--focus"]) style.removeProperty(name);
  } else {
    const color = entry.colors[dark?.matches ? 1 : 0];
    style.setProperty("--accent", color);
    style.setProperty("--accent-soft", rgba(color, dark?.matches ? 0.16 : 0.12));
    style.setProperty("--focus", `0 0 0 3px ${rgba(color, dark?.matches ? 0.4 : 0.35)}`);
  }
  if (!watching && dark?.addEventListener) { watching = true; dark.addEventListener("change", () => applyAccent()); }
}

export function setAccent(id) {
  try { if (id === "rust") localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  applyAccent(id);
}
