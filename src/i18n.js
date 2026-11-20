// English and Arabic. t("English text") returns the text in the chosen
// language; {name} parts are filled from vars. Arabic also flips the layout
// to right to left. Strings with no Arabic yet stay in English.
import { useSyncExternalStore } from "react";
import { AR, AR_PLURALS } from "./i18n-ar.js";

const KEY = "wardrobe-language";
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ar", label: "العربية" },
];

let current = null;
const listeners = new Set();
const pluralRules = new Map();

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function pluralForm(lang, count) {
  const numeric = Math.abs(Number(count) || 0);
  if (typeof Intl !== "undefined" && typeof Intl.PluralRules === "function") {
    let rules = pluralRules.get(lang);
    if (!rules) {
      rules = new Intl.PluralRules(lang);
      pluralRules.set(lang, rules);
    }
    return rules.select(numeric);
  }
  return numeric === 1 ? "one" : "other";
}

export function language() {
  if (current) return current;
  let saved = "";
  try { saved = localStorage.getItem(KEY) || ""; } catch { /* storage unavailable */ }
  if (LANGUAGES.some((entry) => entry.id === saved)) current = saved;
  else current = typeof navigator !== "undefined" && /^ar\b/i.test(navigator.language || "") ? "ar" : "en";
  return current;
}

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, language, language);
}

export function setLanguage(id) {
  if (!LANGUAGES.some((entry) => entry.id === id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  current = id;
  applyLanguage();
  for (const listener of listeners) listener();
}

export function isRtl() {
  return language() === "ar";
}

export function applyLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language();
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
}

export function t(text, vars, context) {
  const key = context ? `${context}:${text}` : text;
  const value = (language() === "ar" && (AR[key] || AR[text])) || text;
  return interpolate(value, vars);
}

// Plural-aware with CLDR Arabic 6-form support: tn(3, "{n} piece", "{n} pieces").
export function tn(count, one, many, vars = {}) {
  const allVars = { ...vars, n: count };
  const lang = language();
  if (lang === "ar") {
    const table = AR_PLURALS?.[one] || AR_PLURALS?.[many];
    if (table) {
      const form = pluralForm("ar", count);
      const template = table[form] ?? table.other ?? table.many ?? table.few ?? table.one;
      if (template) return interpolate(template, allVars);
    }
  }
  const key = pluralForm(lang, count) === "one" ? one : many;
  return t(key, allVars);
}

// Dates in the chosen language, with Western digits.
export function locale() {
  return language() === "ar" ? "ar-u-nu-latn" : "en-GB";
}

export function formatDay(day, options) {
  if (!day || typeof day !== "string") return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month - 1, date);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== date) return "";
  return parsed.toLocaleDateString(locale(), options);
}
