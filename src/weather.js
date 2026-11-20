// Weather from Open-Meteo (free, no key). The request goes straight from this
// device with a rough location (one decimal, about 10 km). Nothing about
// weather or location is sent to the wardrobe server.
import { useCallback, useEffect, useState } from "react";
import { dayString } from "../shared/style.mjs";
import { t } from "./i18n.js";

const SETTINGS_KEY = "wardrobe-weather";
const CACHE_KEY = "wardrobe-weather-cache-2"; // 2: wind and rain amount added
const CACHE_HOURS = 3;
const LOCATION_REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;

export function roundCoord(value) {
  return Math.round(Number(value) * 10) / 10;
}

function readNum(list, index) {
  const raw = list?.[index];
  if (raw === null || raw === undefined || raw === "") return NaN;
  return Number(raw);
}

// WMO weather codes to a short label and whether it means wet weather.
export function describeCode(code) {
  if (!Number.isFinite(code) || code < 0) return { label: "", rain: false };
  if (code === 0) return { label: "Clear", rain: false };
  if (code <= 2) return { label: "Partly cloudy", rain: false };
  if (code === 3) return { label: "Cloudy", rain: false };
  if (code === 45 || code === 48) return { label: "Fog", rain: false };
  if (code >= 51 && code <= 57) return { label: "Drizzle", rain: true };
  if (code >= 61 && code <= 67) return { label: "Rain", rain: true };
  if (code >= 71 && code <= 77) return { label: "Snow", rain: true };
  if (code >= 80 && code <= 86) return { label: "Showers", rain: true };
  if (code >= 95) return { label: "Storm", rain: true };
  return { label: "", rain: false };
}

// Open-Meteo daily answer to { "YYYY-MM-DD": { temperature, rain, label } }.
// Temperature is the day's feel: the middle of the low and high, nudged up.
export function parseForecast(data) {
  const daily = data?.daily;
  if (!daily?.time?.length) return {};
  const forecast = {};
  daily.time.forEach((day, index) => {
    const high = readNum(daily.temperature_2m_max, index);
    const low = readNum(daily.temperature_2m_min, index);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return;
    const { label, rain } = describeCode(readNum(daily.weather_code, index));
    const chance = readNum(daily.precipitation_probability_max, index);
    const wind = readNum(daily.wind_speed_10m_max, index);
    const rainMm = readNum(daily.precipitation_sum, index);
    forecast[day] = {
      temperature: Math.round(low + (high - low) * 0.6), high: Math.round(high), low: Math.round(low), rain: rain || (Number.isFinite(chance) && chance >= 60), label,
      ...(Number.isFinite(wind) ? { wind: Math.round(wind) } : {}),
      ...(Number.isFinite(rainMm) ? { rainMm: Math.round(rainMm * 10) / 10 } : {}),
      ...(Number.isFinite(chance) ? { rainChance: Math.round(chance) } : {}),
    };
  });
  return forecast;
}

export function forecastUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(roundCoord(lat)), longitude: String(roundCoord(lon)),
    daily: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
    timezone: "auto", forecast_days: "16",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

export function weatherSettings() {
  const saved = readJson(SETTINGS_KEY);
  return saved?.mode === "location" || saved?.mode === "city" ? saved : { mode: "off" };
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS, outerSignal = null) {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(outerSignal.reason);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.("abort", onOuterAbort);
  }
}

export async function findCity(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error(t("Could not find that city."));
  const params = new URLSearchParams({ name: trimmed, count: "1", format: "json" });
  let response;
  try {
    response = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  } catch {
    throw new Error(t("Could not find that city."));
  }
  if (!response.ok) throw new Error(t("Could not find that city."));
  const place = (await response.json())?.results?.[0];
  if (!place) throw new Error(t("Could not find that city."));
  return { lat: roundCoord(place.latitude), lon: roundCoord(place.longitude), place: [place.name, place.country_code].filter(Boolean).join(", ") };
}

export function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t("Location is off for this app."))); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: roundCoord(position.coords.latitude), lon: roundCoord(position.coords.longitude), locatedAt: Date.now() }),
      () => reject(new Error(t("Location is off for this app."))),
      { enableHighAccuracy: false, maximumAge: LOCATION_REFRESH_MS, timeout: 15000 },
    );
  });
}

async function loadForecast(settings, signal) {
  const cached = readJson(CACHE_KEY);
  const age = cached ? Date.now() - Number(cached.at) : NaN;
  const fresh = cached && cached.lat === settings.lat && cached.lon === settings.lon && Number.isFinite(age) && age >= 0 && age < CACHE_HOURS * 3600 * 1000;
  if (fresh) return cached.forecast;
  let response;
  try {
    response = await fetchWithTimeout(forecastUrl(settings.lat, settings.lon), FETCH_TIMEOUT_MS, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(t("Could not get the forecast."));
  }
  if (!response.ok) throw new Error(t("Could not get the forecast."));
  const forecast = parseForecast(await response.json());
  writeJson(CACHE_KEY, { lat: settings.lat, lon: settings.lon, at: Date.now(), forecast });
  return forecast;
}

// { settings, setSettings, forecast, today, error }. Off by default.
export function useWeather() {
  const [settings, setState] = useState(weatherSettings);
  const [forecast, setForecast] = useState({});
  const [error, setError] = useState("");

  const setSettings = useCallback((next) => {
    const stored = next.mode === "location" && !next.locatedAt ? { ...next, locatedAt: Date.now() } : next;
    writeJson(SETTINGS_KEY, stored.mode === "off" ? null : stored);
    if (stored.mode === "off") {
      writeJson(CACHE_KEY, null);
      setError("");
    }
    setState(stored);
  }, []);

  useEffect(() => {
    if (settings.mode === "off" || !Number.isFinite(settings.lat) || !Number.isFinite(settings.lon)) {
      setForecast({});
      setError("");
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    loadForecast(settings, controller.signal)
      .then((next) => { if (!cancelled) { setForecast(next); setError(""); } })
      .catch((loadError) => { if (!cancelled && !controller.signal.aborted) setError(loadError.message); });

    // Quietly refresh device coordinates if they are stale (>6h) in location mode.
    const locAge = settings.mode === "location" ? Date.now() - Number(settings.locatedAt || 0) : 0;
    if (settings.mode === "location" && (!Number.isFinite(locAge) || locAge < 0 || locAge >= LOCATION_REFRESH_MS)) {
      deviceLocation()
        .then((coords) => {
          if (cancelled) return;
          if (coords.lat !== settings.lat || coords.lon !== settings.lon) {
            setSettings({ ...settings, ...coords });
          } else {
            writeJson(SETTINGS_KEY, { ...settings, locatedAt: coords.locatedAt });
          }
        })
        .catch(() => { /* keep existing coordinates when offline or denied */ });
    }
    return () => { cancelled = true; controller.abort(); };
  }, [settings, setSettings]);

  const todayRaw = forecast[dayString()] || null;
  const today = todayRaw && Number.isFinite(settings.lat) ? { ...todayRaw, lat: settings.lat } : todayRaw;

  return { settings, setSettings, forecast, today, error };
}
