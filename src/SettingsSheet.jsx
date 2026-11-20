import { useEffect, useRef, useState } from "react";
import { CheckCircle, CloudCheck, CloudSun, HardDrives, MapPin, Moon, Palette, SignOut, SpinnerGap, Translate, WarningCircle, X } from "@phosphor-icons/react";
import { ACCENTS, THEMES, accent, setAccent, setTheme, theme } from "./accent.js";
import { AiSettings } from "./AiSettings.jsx";
import { accessToken, connectionLabel, forgetConnection, isNativeApp, serverUrl, testConnection } from "./api.js";
import { LANGUAGES, language, setLanguage, t, tn, useLanguage } from "./i18n.js";
import { useSheetDrag } from "./useSheetDrag.js";
import { deviceLocation, findCity } from "./weather.js";
import { canUseLocalMode, isLocalMode, localApi, setClosetMode } from "./local/mode.js";
import { useDialog } from "./dialog.js";

// Where the closet lives and how this device is connected to it.
export function SettingsSheet({ onClose, pieces, weather }) {
  useLanguage();
  const native = isNativeApp();
  const [status, setStatus] = useState({ state: "checking" });
  const [confirmAction, setConfirmAction] = useState(null); // "switch" | "forget" | null
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  useDialog({ open: true, onClose, initialFocusRef: closeRef, containerRef: sheetRef });

  useEffect(() => {
    let cancelled = false;
    testConnection({ server: serverUrl(), token: accessToken() }).then((result) => {
      if (!cancelled) setStatus({ state: result.ok ? "ok" : "failed", ...result });
    });
    return () => { cancelled = true; };
  }, []);

  const switchServer = async () => {
    await forgetConnection();
    window.location.reload();
  };

  const signOut = async () => {
    await forgetConnection({ keepServer: true });
    window.location.reload();
  };

  const config = status.config || {};
  const [chosenAccent, setChosenAccent] = useState(accent);
  const [chosenTheme, setChosenTheme] = useState(theme);
  const { handleProps, sheetStyle } = useSheetDrag(onClose);
  const aiChanged = (ai) => setStatus((current) => ({
    ...current,
    config: { ...current.config, ready: ai.ready, provider: ai.provider, providerName: ai.providers.find((entry) => entry.id === ai.provider)?.name },
  }));
  const storage = config.storage === "cloudflare" ? t("Cloudflare") : config.storage === "icloud" ? t("iCloud") : config.storage === "device" ? t("This device") : t("Your server");
  const version = status.server?.version;

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" style={sheetStyle}>
        <span className="sheet-grabber" aria-hidden="true" {...handleProps} />
        <header className="settings-sheet__header" {...handleProps}>
          <div>
            <p className="eyebrow">{t("Settings")}</p>
            <h2 id="settings-title">{t("Your wardrobe")}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label={t("Close settings")}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-card">
          <span className="settings-card__icon" aria-hidden="true">
            {config.storage === "cloudflare" || config.local ? <CloudCheck size={22} /> : <HardDrives size={22} />}
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
          {!config.local && <div><dt>{t("Protected by token")}</dt><dd>{typeof status.server?.protected !== "boolean" ? "-" : status.server.protected ? t("Yes") : t("No, this computer only")}</dd></div>}
          {version && !config.local && <div><dt>{t("Server version")}</dt><dd>{version}</dd></div>}
        </dl>

        {status.state === "ok" && <AiSettings onChange={aiChanged} />}

        <section className="settings-section">
          <h3><Translate size={16} aria-hidden="true" /> {t("Language")}</h3>
          <div className="segmented" role="group" aria-label={t("Language")}>
            {LANGUAGES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                lang={entry.id}
                className={language() === entry.id ? "active" : ""}
                aria-pressed={language() === entry.id}
                onClick={() => { if (language() !== entry.id) setLanguage(entry.id); }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3><Moon size={16} aria-hidden="true" /> {t("Appearance")}</h3>
          <div className="segmented" role="group" aria-label={t("Appearance")}>
            {THEMES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={chosenTheme === entry.id ? "active" : ""}
                aria-pressed={chosenTheme === entry.id}
                onClick={() => { setTheme(entry.id); setChosenTheme(entry.id); }}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3><Palette size={16} aria-hidden="true" /> {t("Accent color")}</h3>
          <div className="accent-picker" role="group" aria-label={t("Accent color")}>
            {ACCENTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={chosenAccent === entry.id ? "active" : ""}
                aria-pressed={chosenAccent === entry.id}
                aria-label={t(entry.label)}
                title={t(entry.label)}
                onClick={() => { setAccent(entry.id); setChosenAccent(entry.id); }}
              >
                <span style={{ backgroundColor: entry.colors[0] }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        {canUseLocalMode() && <ClosetPlace serverReady={status.state === "ok" && !isLocalMode()} />}

        {weather && <WeatherSettings weather={weather} />}

        {confirmAction && (
          <div className="confirm-bar" role="alert">
            <span>
              {confirmAction === "switch"
                ? t("Disconnect from this server?")
                : t("Forget the saved access token?")}
            </span>
            <button type="button" className="secondary-button" onClick={() => setConfirmAction(null)}>{t("Cancel")}</button>
            <button type="button" className="delete-button" onClick={confirmAction === "switch" ? switchServer : signOut}>
              {confirmAction === "switch" ? t("Switch server") : t("Forget token")}
            </button>
          </div>
        )}

        <div className="settings-actions">
          {native && !isLocalMode() && (
            <button className="secondary-button" type="button" onClick={() => setConfirmAction("switch")}>
              <HardDrives size={16} aria-hidden="true" /> {t("Switch server")}
            </button>
          )}
          {accessToken() && (
            <button className="secondary-button danger" type="button" onClick={() => setConfirmAction("forget")}>
              <SignOut size={16} aria-hidden="true" /> {t("Forget token")}
            </button>
          )}
        </div>

        {!isLocalMode() && (
          <p className="settings-note">
            {native
              ? t("At home, use your server's address on Wi-Fi (for example http://192.168.1.20:4173). Away from home, use an HTTPS address, such as a Synology DDNS name or Tailscale.")
              : t("Everything you add is saved on this server. Open the same address in any browser, or connect the phone app to it.")}
          </p>
        )}
      </section>
    </div>
  );
}

// Off, my location, or a typed city. The forecast picks warmer or lighter
// outfits for Home and the plan.
function WeatherSettings({ weather }) {
  const { settings, setSettings, today, error: loadError } = weather;
  const [city, setCity] = useState(settings.mode === "city" ? settings.place || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const run = async (task) => {
    setBusy(true);
    setError("");
    try {
      const next = await task();
      if (aliveRef.current) setSettings(next);
    } catch (requestError) {
      if (aliveRef.current) setError(requestError.message);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };
  const useLocation = () => run(async () => ({ mode: "location", ...(await deviceLocation()) }));
  const useCity = (event) => { event.preventDefault(); if (city.trim()) run(async () => ({ mode: "city", ...(await findCity(city)) })); };
  const place = settings.mode === "city" ? settings.place : t("Your location");

  return (
    <section className="settings-section">
      <h3><CloudSun size={16} aria-hidden="true" /> {t("Weather")}</h3>
      <p className="settings-note">{t("Use the forecast for Home and the plan")}</p>
      {settings.mode !== "off" && (
        <p className="weather-now">
          <MapPin size={14} aria-hidden="true" /> {t("Weather for {place}", { place })}
          {today && <> · <bdi>{`${today.low}° / ${today.high}°C`}</bdi> {t(today.label)}</>}
        </p>
      )}
      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={useLocation} disabled={busy} aria-busy={busy}>
          {busy ? <SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />} {t("Use my location")}
        </button>
        {settings.mode !== "off" && <button className="secondary-button" type="button" onClick={() => setSettings({ mode: "off" })}>{t("Turn off")}</button>}
      </div>
      <form className="weather-city" onSubmit={useCity}>
        <label className="visually-hidden" htmlFor="weather-city">{t("City")}</label>
        <input id="weather-city" value={city} onChange={(event) => setCity(event.target.value)} placeholder={t("Type a city")} autoComplete="address-level2" />
        <button className="secondary-button" type="submit" disabled={busy || !city.trim()}>{t("Find")}</button>
      </form>
      {(error || loadError) && <p className="status error" role="alert">{error || loadError}</p>}
      <p className="settings-note">{t("Forecast from Open-Meteo. Only a rough location (about 10 km) is sent, from this device, and never to us.")}</p>
    </section>
  );
}

// Server or iCloud. Moving copies the closet; it never deletes the server's.
function ClosetPlace({ serverReady }) {
  const local = isLocalMode();
  const [state, setState] = useState({ status: "idle" });
  const aliveRef = useRef(true);
  const reloadTimerRef = useRef(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const moving = state.status === "copying" || state.status === "done";

  const move = async () => {
    if (moving) return;
    setState({ status: "copying", done: 0, total: 0 });
    try {
      const { copyServerToLocal } = await import("./local/migrate.js");
      const result = await copyServerToLocal((done, total) => {
        if (aliveRef.current) setState({ status: "copying", done, total });
      });
      if (!aliveRef.current) return;
      // Pictures that would not copy: stay here and say so. The person
      // can try again; pictures already copied are not fetched twice.
      if (result.failed) {
        setState({
          status: "failed",
          message: tn(result.failed, "{n} picture could not be copied. Check the server and try again.", "{n} pictures could not be copied. Check the server and try again."),
        });
        return;
      }
      setState({ status: "done", pieces: result.pieces });
      setClosetMode("local");
      reloadTimerRef.current = setTimeout(() => {
        if (aliveRef.current) window.location.reload();
      }, 600);
    } catch (error) {
      if (aliveRef.current) setState({ status: "failed", message: error.message });
    }
  };
  const leave = () => {
    if (moving) return;
    setClosetMode("server");
    window.location.reload();
  };
  const kind = local ? localApi().store.kind : null;

  return (
    <section className="settings-section">
      <h3><CloudCheck size={16} aria-hidden="true" /> {t("Where your closet lives")}</h3>
      <div className="segmented" role="group" aria-label={t("Where your closet lives")}>
        <button type="button" className={!local ? "active" : ""} aria-pressed={!local} disabled={moving} onClick={local ? leave : undefined}>
          {t("On a server")}
        </button>
        <button
          type="button"
          className={local ? "active" : ""}
          aria-pressed={local}
          disabled={moving}
          onClick={local ? undefined : serverReady ? move : () => { setClosetMode("local"); window.location.reload(); }}
        >
          {t("In iCloud")}
        </button>
      </div>
      {local && (
        <p className="settings-note">
          {kind === "icloud"
            ? t("Saved in your iCloud. It syncs to your other iPhone and iPad signed in to the same Apple Account.")
            : t("iCloud is off on this device, so the closet is saved here only. Turn on iCloud Drive to sync it.")}
        </p>
      )}
      {local && <p className="settings-note">{t("Your iCloud closet stays where it is, so you can come back to it.")}</p>}
      {!local && serverReady && (
        <>
          <button className="secondary-button" type="button" onClick={move} disabled={moving} aria-busy={state.status === "copying"}>
            {state.status === "copying" ? <SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> : <CloudCheck size={16} aria-hidden="true" />}
            {state.status === "copying" && state.total ? t("Copying {done} of {total}", { done: state.done, total: state.total }) : t("Copy my closet to iCloud")}
          </button>
          <p className="settings-note">{t("Your server keeps its copy. After the move, add your AI key again: keys stay on the server and are not copied.")}</p>
        </>
      )}
      {state.status === "done" && <p className="status" role="status">{t("Copied {n} pieces. Switching to iCloud…", { n: state.pieces })}</p>}
      {state.status === "failed" && <p className="status error" role="alert">{state.message}</p>}
    </section>
  );
}
