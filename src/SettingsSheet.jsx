import { useEffect, useState } from "react";
import { CheckCircle, CloudCheck, CloudSun, HardDrives, MapPin, SignOut, SpinnerGap, Translate, TShirt, WarningCircle, X } from "@phosphor-icons/react";
import { AiSettings } from "./AiSettings.jsx";
import { accessToken, connectionLabel, forgetConnection, isNativeApp, serverUrl, testConnection } from "./api.js";
import { LANGUAGES, language, setLanguage, t } from "./i18n.js";
import { deviceLocation, findCity } from "./weather.js";

// Where the closet lives and how this device is connected to it.
export function SettingsSheet({ onClose, pieces, weather, onStarter }) {
  const native = isNativeApp();
  const [status, setStatus] = useState({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    testConnection({ server: serverUrl(), token: accessToken() }).then((result) => {
      if (!cancelled) setStatus({ state: result.ok ? "ok" : "failed", ...result });
    });
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
    };
  }, [onClose]);

  const switchServer = () => {
    forgetConnection();
    window.location.reload();
  };

  const signOut = () => {
    forgetConnection({ keepServer: true });
    window.location.reload();
  };

  const config = status.config || {};
  const aiChanged = (ai) => setStatus((current) => ({
    ...current,
    config: { ...current.config, ready: ai.ready, provider: ai.provider, providerName: ai.providers.find((entry) => entry.id === ai.provider)?.name },
  }));
  const storage = config.storage === "cloudflare" ? t("Cloudflare") : t("Your server");
  const version = status.server?.version;

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">{t("Settings")}</p>
            <h2 id="settings-title">{t("Your wardrobe")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close settings")}><X size={20} aria-hidden="true" /></button>
        </header>

        <div className="settings-card">
          <span className="settings-card__icon" aria-hidden="true">
            {config.storage === "cloudflare" ? <CloudCheck size={22} /> : <HardDrives size={22} />}
          </span>
          <div className="settings-card__body">
            <strong>{connectionLabel() || t("This server")}</strong>
            <span className={`settings-status is-${status.state}`}>
              {status.state === "checking" && <><SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> {t("Checking…")}</>}
              {status.state === "ok" && <><CheckCircle size={14} weight="fill" aria-hidden="true" /> {t("Connected")}</>}
              {status.state === "failed" && <><WarningCircle size={14} weight="fill" aria-hidden="true" /> {status.reason === "token" ? t("Token not accepted") : t("Not reachable")}</>}
            </span>
          </div>
        </div>

        <dl className="settings-list">
          <div><dt>{t("Pieces")}</dt><dd>{pieces}</dd></div>
          <div><dt>{t("Photos stored on")}</dt><dd>{status.state === "ok" ? storage : "-"}</dd></div>
          <div><dt>{t("AI styling")}</dt><dd>{status.state !== "ok" ? "-" : config.ready ? t("Ready ({name})", { name: config.providerName || "Claude" }) : t("Add a {name} key below", { name: config.providerName || "Claude" })}</dd></div>
          <div><dt>{t("Protected by token")}</dt><dd>{typeof status.server?.protected !== "boolean" ? "-" : status.server.protected ? t("Yes") : t("No, this computer only")}</dd></div>
          {version && <div><dt>{t("Server version")}</dt><dd>{version}</dd></div>}
        </dl>

        {status.state === "ok" && <AiSettings onChange={aiChanged} />}

        <section className="settings-section">
          <h3><Translate size={16} aria-hidden="true" /> {t("Language")}</h3>
          <div className="segmented" role="group" aria-label={t("Language")}>
            {LANGUAGES.map((entry) => (
              <button key={entry.id} type="button" lang={entry.id} className={language() === entry.id ? "active" : ""} aria-pressed={language() === entry.id}
                onClick={() => { if (language() !== entry.id) { setLanguage(entry.id); window.location.reload(); } }}>
                {entry.label}
              </button>
            ))}
          </div>
        </section>

        {weather && <WeatherSettings weather={weather} />}

        {onStarter && (
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onStarter}><TShirt size={16} aria-hidden="true" /> {t("Add basics, no photo")}</button>
          </div>
        )}

        <div className="settings-actions">
          {native && (
            <button className="secondary-button" type="button" onClick={switchServer}>
              <HardDrives size={16} aria-hidden="true" /> {t("Switch server")}
            </button>
          )}
          {accessToken() && (
            <button className="secondary-button danger" type="button" onClick={signOut}>
              <SignOut size={16} aria-hidden="true" /> {t("Forget token")}
            </button>
          )}
        </div>

        <p className="settings-note">
          {native
            ? t("At home, use your server's address on Wi-Fi (for example http://192.168.1.20:4173). Away from home, use an HTTPS address, such as a Synology DDNS name or Tailscale.")
            : t("Everything you add is saved on this server. Open the same address in any browser, or connect the phone app to it.")}
        </p>
      </section>
    </div>
  );
}

// Off, my location, or a typed city. The forecast picks warmer or lighter
// outfits for Today and the plan.
function WeatherSettings({ weather }) {
  const { settings, setSettings, today, error: loadError } = weather;
  const [city, setCity] = useState(settings.mode === "city" ? settings.place || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (task) => {
    setBusy(true); setError("");
    try { setSettings(await task()); } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const useLocation = () => run(async () => ({ mode: "location", ...(await deviceLocation()) }));
  const useCity = (event) => { event.preventDefault(); if (city.trim()) run(async () => ({ mode: "city", ...(await findCity(city)) })); };
  const place = settings.mode === "city" ? settings.place : t("Your location");

  return (
    <section className="settings-section">
      <h3><CloudSun size={16} aria-hidden="true" /> {t("Weather")}</h3>
      <p className="settings-note">{t("Use the forecast for Today and the plan")}</p>
      {settings.mode !== "off" && (
        <p className="weather-now">
          <MapPin size={14} aria-hidden="true" /> {t("Weather for {place}", { place })}
          {today && <> · {today.low}° / {today.high}°C {t(today.label)}</>}
        </p>
      )}
      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={useLocation} disabled={busy}>
          {busy ? <SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />} {t("Use my location")}
        </button>
        {settings.mode !== "off" && <button className="secondary-button" type="button" onClick={() => setSettings({ mode: "off" })}>{t("Turn off")}</button>}
      </div>
      <form className="weather-city" onSubmit={useCity}>
        <label className="visually-hidden" htmlFor="weather-city">{t("City")}</label>
        <input id="weather-city" value={city} onChange={(event) => setCity(event.target.value)} placeholder={t("Type a city")} autoComplete="address-level2" />
        <button className="secondary-button" type="submit" disabled={busy || !city.trim()}>{t("Find")}</button>
      </form>
      {(error || loadError) && <p className="status error">{error || loadError}</p>}
      <p className="settings-note">{t("Forecast from Open-Meteo. Only a rough location (about 10 km) is sent, from this device, and never to us.")}</p>
    </section>
  );
}
