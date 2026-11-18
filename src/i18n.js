// English and Arabic. t("English text") returns the text in the chosen
// language; {name} parts are filled from vars. Arabic also flips the layout
// to right to left. Strings with no Arabic yet stay in English.
import { AR } from "./i18n-ar.js";

const KEY = "wardrobe-language";
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ar", label: "العربية" },
];

let current = null;

export function language() {
  if (current) return current;
  let saved = "";
  try { saved = localStorage.getItem(KEY) || ""; } catch { /* storage unavailable */ }
  if (LANGUAGES.some((entry) => entry.id === saved)) current = saved;
  else current = typeof navigator !== "undefined" && /^ar\b/i.test(navigator.language || "") ? "ar" : "en";
  return current;
}

export function setLanguage(id) {
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  current = id;
  applyLanguage();
}

export function isRtl() {
  return language() === "ar";
}

export function applyLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language();
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
}

export function t(text, vars) {
  let value = (language() === "ar" && AR[text]) || text;
  if (vars) value = value.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  return value;
}

// Plural-aware: tn(3, "{n} piece", "{n} pieces").
export function tn(count, one, many) {
  return t(count === 1 ? one : many, { n: count });
}

// Dates in the chosen language, with Western digits.
export function locale() {
  return language() === "ar" ? "ar-u-nu-latn" : "en-GB";
}

export function formatDay(day, options) {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(locale(), options);
}
