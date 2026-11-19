// Weather from Open-Meteo (free, no key). The request goes straight from this
// device with a rough location (one decimal, about 10 km). Nothing about
// weather or location is sent to the wardrobe server.
import { useCallback, useEffect, useState } from "react";
import { dayString } from "../shared/style.mjs";
import { t } from "./i18n.js";

const SETTINGS_KEY = "wardrobe-weather";
const CACHE_KEY = "wardrobe-weather-cache";
const CACHE_HOURS = 3;

export function roundCoord(value) {
  return Math.round(Number(value) * 10) / 10;
}

// WMO weather codes to a short label and whether it means wet weather.
export function describeCode(code) {
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
    const high = Number(daily.temperature_2m_max?.[index]);
    const low = Number(daily.temperature_2m_min?.[index]);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return;
    const { label, rain } = describeCode(Number(daily.weather_code?.[index]));
    const chance = Number(daily.precipitation_probability_max?.[index]);
    forecast[day] = { temperature: Math.round(low + (high - low) * 0.6), high: Math.round(high), low: Math.round(low), rain: rain || chance >= 60, label };
  });
  return forecast;
}

export function forecastUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(roundCoord(lat)), longitude: String(roundCoord(lon)),
    daily: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
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

export async function findCity(name) {
  const params = new URLSearchParams({ name: name.trim(), count: "1", format: "json" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error(t("Could not find that city."));
  const place = (await response.json())?.results?.[0];
  if (!place) throw new Error(t("Could not find that city."));
  return { lat: roundCoord(place.latitude), lon: roundCoord(place.longitude), place: [place.name, place.country_code].filter(Boolean).join(", ") };
}

export function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t("Location is off for this app."))); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: roundCoord(position.coords.latitude), lon: roundCoord(position.coords.longitude) }),
      () => reject(new Error(t("Location is off for this app."))),
      { enableHighAccuracy: false, maximumAge: 6 * 60 * 60 * 1000, timeout: 15000 },
    );
  });
}

async function loadForecast(settings) {
  const cached = readJson(CACHE_KEY);
  const fresh = cached && cached.lat === settings.lat && cached.lon === settings.lon && Date.now() - cached.at < CACHE_HOURS * 3600 * 1000;
  if (fresh) return cached.forecast;
  const response = await fetch(forecastUrl(settings.lat, settings.lon));
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

  useEffect(() => {
    if (settings.mode === "off" || !Number.isFinite(settings.lat)) { setForecast({}); return undefined; }
    let cancelled = false;
    loadForecast(settings)
      .then((next) => { if (!cancelled) { setForecast(next); setError(""); } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, [settings]);

  const setSettings = useCallback((next) => {
    writeJson(SETTINGS_KEY, next.mode === "off" ? null : next);
    if (next.mode === "off") writeJson(CACHE_KEY, null);
    setState(next);
  }, []);

  return { settings, setSettings, forecast, today: forecast[dayString()] || null, error };
}
