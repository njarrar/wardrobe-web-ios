import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Check, Eye, EyeSlash, Key, SpinnerGap, Trash } from "@phosphor-icons/react";
import { AI_CHANGED_EVENT, apiFetch } from "./api.js";
import { isLocalMode } from "./local/mode.js";
import { isRtl, t } from "./i18n.js";
import { handleRovingKeys } from "./dialog.js";

const SETTINGS_API = "/api/import/settings/ai";

async function request(method, body, signal) {
  const response = await apiFetch(SETTINGS_API, {
    method,
    signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || t("Could not reach the AI settings."));
  return value;
}

function keyStatus(entry) {
  if (!entry.hasKey) return t("No key yet");
  if (isLocalMode() && entry.keySource === "app") return t("Key saved in the Keychain on this device ({hint})", { hint: entry.keyHint });
  return entry.keySource === "app" ? t("Key saved ({hint})", { hint: entry.keyHint }) : t("Key set on the server ({hint})", { hint: entry.keyHint });
}

// Pick which AI reads photos and styles outfits, and give it an API key.
// Keys stay on the server; this screen only ever sees their last four characters.
export function AiSettings({ onChange }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedBadge, setSavedBadge] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pendingProvider, setPendingProvider] = useState(null);
  const aliveRef = useRef(true);
  const savedTimerRef = useRef(null);

  const selected = settings?.providers.find((entry) => entry.id === settings.provider);

  useEffect(() => {
    aliveRef.current = true;
    const controller = new AbortController();
    request("GET", null, controller.signal)
      .then((value) => { if (aliveRef.current) setSettings(value); })
      .catch((requestError) => {
        if (!aliveRef.current || controller.signal.aborted || requestError?.name === "AbortError") return;
        setError(requestError.message);
      });
    return () => {
      aliveRef.current = false;
      controller.abort();
      clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setKey("");
    setShowKey(false);
    setConfirmRemove(false);
    setPendingProvider(null);
    setModel(selected && selected.model !== selected.defaultModel ? selected.model : "");
  }, [selected?.id, selected?.model, selected?.defaultModel]);

  const save = async (change, showSaved = true) => {
    setBusy(true);
    setError("");
    try {
      const value = await request("PUT", change);
      if (!aliveRef.current) return false;
      setSettings(value);
      onChange?.(value);
      window.dispatchEvent(new Event(AI_CHANGED_EVENT));
      if (showSaved) {
        setSavedBadge(true);
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => { if (aliveRef.current) setSavedBadge(false); }, 3000);
      }
      return true;
    } catch (requestError) {
      if (aliveRef.current) setError(requestError.message);
      return false;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  if (!settings) {
    return (
      <section className="ai-settings" aria-labelledby="ai-settings-title">
        <h3 id="ai-settings-title">{t("AI")}</h3>
        <p className={error ? "status error" : "settings-note"} role={error ? "alert" : undefined}>
          {error || <><SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> {t("Loading…")}</>}
        </p>
      </section>
    );
  }

  const modelChanged = model.trim() !== (selected.model !== selected.defaultModel ? selected.model : "");
  const hasDraft = Boolean(key.trim() || modelChanged);

  const selectProvider = (providerId) => {
    if (providerId === settings.provider || busy) return;
    if (hasDraft) {
      setPendingProvider(providerId);
      return;
    }
    save({ provider: providerId }, false);
  };

  const confirmProviderSwitch = () => {
    if (!pendingProvider) return;
    const next = pendingProvider;
    setPendingProvider(null);
    save({ provider: next }, false);
  };

  const submit = async (event) => {
    event.preventDefault();
    const change = {};
    if (key.trim()) change.keys = { [selected.id]: key.trim() };
    if (modelChanged) change.models = { [selected.id]: model.trim() };
    if (Object.keys(change).length && await save(change, true)) {
      setKey("");
      setShowKey(false);
    }
  };

  const removeKey = async () => {
    setConfirmRemove(false);
    await save({ keys: { [selected.id]: null } }, false);
  };

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title">
      <h3 id="ai-settings-title">{t("AI")}</h3>
      <p className="ai-settings__lead">{t("Pick the AI that finds clothes in your photos and styles outfits.")}</p>

      <div className="segmented ai-switch" role="radiogroup" aria-label={t("AI provider")}>
        {settings.providers.map((entry, index) => {
          const checked = entry.id === settings.provider;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              tabIndex={checked ? 0 : -1}
              aria-checked={checked}
              className={checked ? "active" : ""}
              disabled={busy}
              onClick={() => selectProvider(entry.id)}
              onKeyDown={(event) => handleRovingKeys(event, {
                index,
                count: settings.providers.length,
                rtl: isRtl(),
                onSelect: (nextIdx) => selectProvider(settings.providers[nextIdx].id),
              })}
            >
              {entry.name}
            </button>
          );
        })}
      </div>

      {pendingProvider && (
        <div className="confirm-bar" role="alert">
          <span>{t("Discard your unsaved AI changes and switch provider?")}</span>
          <button type="button" className="secondary-button" onClick={() => setPendingProvider(null)}>{t("Cancel")}</button>
          <button type="button" className="delete-button" onClick={confirmProviderSwitch}>{t("Switch")}</button>
        </div>
      )}

      <form className="ai-settings__form" onSubmit={submit}>
        <p className={`ai-settings__status${selected.hasKey ? " is-ok" : ""}`}>
          <Key size={14} aria-hidden="true" /> {selected.maker} · {keyStatus(selected)}
        </p>
        <label className="field">
          <span>{selected.hasKey ? t("Replace API key") : t("API key")}</span>
          <div className="password-row">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={t("Paste your {name} API key", { name: selected.name })}
              autoComplete="off"
              spellCheck="false"
              autoCapitalize="off"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowKey((current) => !current)}
              aria-label={showKey ? t("Hide API key") : t("Show API key")}
              aria-pressed={showKey}
            >
              {showKey ? <EyeSlash size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </div>
        </label>
        <label className="field">
          <span>{t("Model (leave empty for {model})", { model: selected.defaultModel })}</span>
          <input
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={selected.defaultModel}
            autoComplete="off"
            spellCheck="false"
            autoCapitalize="off"
          />
        </label>
        {confirmRemove && (
          <div className="confirm-bar" role="alert">
            <span>{t("Remove the saved {name} API key?", { name: selected.name })}</span>
            <button type="button" className="secondary-button" onClick={() => setConfirmRemove(false)} disabled={busy}>{t("Cancel")}</button>
            <button type="button" className="delete-button" onClick={removeKey} disabled={busy}>
              <Trash size={14} aria-hidden="true" /> {t("Remove key")}
            </button>
          </div>
        )}
        <div className="settings-actions">
          <button className="primary-button" type="submit" disabled={busy || !hasDraft} aria-busy={busy}>
            {busy ? <SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> : null} {t("Save")}
          </button>
          {savedBadge && (
            <span className="status ai-settings__saved" role="status">
              <Check size={14} weight="bold" aria-hidden="true" /> {t("Saved")}
            </span>
          )}
          {selected.keySource === "app" && (
            <button className="secondary-button danger" type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>
              <Trash size={16} aria-hidden="true" /> {t("Remove key")}
            </button>
          )}
        </div>
        {error && <p className="ai-settings__error" role="alert">{error}</p>}
      </form>

      <p className="settings-note">
        <a href={selected.keyUrl} target="_blank" rel="noreferrer">{t("Get your {maker} API key", { maker: selected.maker })} <ArrowSquareOut size={12} aria-hidden="true" /></a>
        {" "}{t("API keys are billed by use, apart from any ChatGPT, Gemini or Claude plan. Signing in with those plans only works in their own apps, so this app needs a key.")}
      </p>
    </section>
  );
}
