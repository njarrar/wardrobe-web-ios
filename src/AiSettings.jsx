import { useEffect, useState } from "react";
import { ArrowSquareOut, Key, SpinnerGap, Trash } from "@phosphor-icons/react";
import { AI_CHANGED_EVENT, apiFetch } from "./api.js";

const SETTINGS_API = "/api/import/settings/ai";

async function request(method, body) {
  const response = await apiFetch(SETTINGS_API, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Could not reach the AI settings.");
  return value;
}

function keyStatus(entry) {
  if (!entry.hasKey) return "No key yet";
  return entry.keySource === "app" ? `Key saved (${entry.keyHint})` : `Key set on the server (${entry.keyHint})`;
}

// Pick which AI reads photos and styles outfits, and give it an API key.
// Keys stay on the server; this screen only ever sees their last four characters.
export function AiSettings({ onChange }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");

  const selected = settings?.providers.find((entry) => entry.id === settings.provider);

  useEffect(() => {
    request("GET").then(setSettings).catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    setKey("");
    setModel(selected && selected.model !== selected.defaultModel ? selected.model : "");
  }, [selected?.id, selected?.model, selected?.defaultModel]);

  const save = async (change) => {
    setBusy(true); setError("");
    try {
      const value = await request("PUT", change);
      setSettings(value);
      onChange?.(value);
      window.dispatchEvent(new Event(AI_CHANGED_EVENT));
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally { setBusy(false); }
  };

  if (!settings) {
    return (
      <section className="ai-settings" aria-labelledby="ai-settings-title">
        <h3 id="ai-settings-title">AI</h3>
        <p className="settings-note">{error || <><SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> Loading…</>}</p>
      </section>
    );
  }

  const modelChanged = model.trim() !== (selected.model !== selected.defaultModel ? selected.model : "");
  const submit = async (event) => {
    event.preventDefault();
    const change = {};
    if (key.trim()) change.keys = { [selected.id]: key.trim() };
    if (modelChanged) change.models = { [selected.id]: model.trim() };
    if (Object.keys(change).length && await save(change)) setKey("");
  };

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title">
      <h3 id="ai-settings-title">AI</h3>
      <p className="ai-settings__lead">Pick the AI that finds clothes in your photos and styles outfits.</p>

      <div className="view-switch ai-switch" role="radiogroup" aria-label="AI provider">
        {settings.providers.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry.id === settings.provider}
            className={entry.id === settings.provider ? "active" : ""}
            disabled={busy}
            onClick={() => entry.id !== settings.provider && save({ provider: entry.id })}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <form className="ai-settings__form" onSubmit={submit}>
        <p className={`ai-settings__status${selected.hasKey ? " is-ok" : ""}`}>
          <Key size={14} aria-hidden="true" /> {selected.maker} · {keyStatus(selected)}
        </p>
        <label className="field">
          <span>{selected.hasKey ? "Replace API key" : "API key"}</span>
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={`Paste your ${selected.name} API key`}
            autoComplete="off"
            spellCheck="false"
            autoCapitalize="off"
          />
        </label>
        <label className="field">
          <span>Model (leave empty for {selected.defaultModel})</span>
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
        <div className="settings-actions">
          <button className="primary-button" type="submit" disabled={busy || (!key.trim() && !modelChanged)}>
            {busy ? <SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> : null} Save
          </button>
          {selected.keySource === "app" && (
            <button className="secondary-button danger" type="button" disabled={busy} onClick={() => save({ keys: { [selected.id]: null } })}>
              <Trash size={16} aria-hidden="true" /> Remove key
            </button>
          )}
        </div>
        {error && <p className="ai-settings__error" role="alert">{error}</p>}
      </form>

      <p className="settings-note">
        <a href={selected.keyUrl} target="_blank" rel="noreferrer">Get your {selected.maker} API key <ArrowSquareOut size={12} aria-hidden="true" /></a>
        {" "}API keys are billed by use, apart from any ChatGPT, Gemini or Claude plan. Signing in with those plans only works in their own apps, so this app needs a key.
      </p>
    </section>
  );
}
