import { useState } from "react";
import { ArrowSquareOut, CaretLeft, CaretRight, CheckCircle, CloudCheck, CoatHanger, Eye, EyeSlash, Globe, HardDrives, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { accessToken, isNativeApp, normalizeServerUrl, saveConnection, serverUrl, testConnection } from "./api.js";
import { LANGUAGES, isRtl, language, setLanguage, t, useLanguage } from "./i18n.js";
import { canUseLocalMode, setClosetMode } from "./local/mode.js";

const MESSAGES = {
  setup: "Your closet, kept on your own server.",
  token: "This wardrobe is protected. Enter the access token you set on the server.",
  unreachable: "Could not reach your wardrobe. Check the address, and that the server is running.",
};

const SETUP_GUIDE = "https://github.com/njarrar/wardrobe-web-ios#run-it-on-your-synology-nas-docker";

// What a new person needs before this screen can do anything.
const NEEDS = [
  "A Wardrobe server on your NAS, a computer, or Cloudflare",
  "Its address",
  "Its access token (WARDROBE_TOKEN)",
];

const FAILURES = {
  unreachable: "No answer from that address. On home Wi-Fi use the NAS IP and port (for example 192.168.1.20:4173). Away from home, use your HTTPS address.",
  token: "The server answered, but the access token was not accepted.",
  server: "The server answered with an error. Check the container logs on your NAS.",
};

const EXAMPLES = [
  { icon: HardDrives, title: "Synology NAS at home", value: "http://192.168.1.20:4173" },
  { icon: Globe, title: "From anywhere (HTTPS)", value: "https://wardrobe.yourname.synology.me" },
];

function isValidServerUrl(raw) {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function ConnectScreen({ reason }) {
  useLanguage();
  const native = isNativeApp();
  const showICloudOption = native && reason !== "token" && canUseLocalMode();
  const [mode, setMode] = useState("server");
  const [server, setServer] = useState(serverUrl() || "");
  const [token, setToken] = useState(accessToken());
  const [showToken, setShowToken] = useState(false);
  const [state, setState] = useState({ status: "idle" });
  const rtl = isRtl();

  const submit = async (event) => {
    event.preventDefault();
    const trimmedServer = server.trim();
    const trimmedToken = token.trim();
    if (native && !isValidServerUrl(trimmedServer)) {
      setState({ status: "failed", message: t("Enter a valid server address, such as 192.168.1.20:4173.") });
      return;
    }
    setState({ status: "testing" });
    const target = native ? normalizeServerUrl(trimmedServer) : "";
    const result = await testConnection({ server: target, token: trimmedToken });
    if (!result.ok) {
      setState({ status: "failed", message: t(FAILURES[result.reason] || FAILURES.server) });
      return;
    }
    setState({ status: "ok" });
    await saveConnection({ server: native ? target : undefined, token: trimmedToken });
    setTimeout(() => window.location.reload(), 350);
  };

  const applyExample = (value) => {
    if (!server.trim() || EXAMPLES.some((entry) => entry.value === server.trim())) {
      setServer(value);
    }
  };

  const busy = state.status === "testing" || state.status === "ok";
  const showingICloud = showICloudOption && mode === "icloud";

  return (
    <main className="connect-screen">
      <div className="connect-glow" aria-hidden="true" />
      <div className="connect-lang" role="group" aria-label={t("Language")}>
        {LANGUAGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            lang={entry.id}
            className={language() === entry.id ? "active" : ""}
            aria-pressed={language() === entry.id}
            onClick={() => setLanguage(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form className="connect-card" onSubmit={submit}>
        <div className="connect-brand">
          <span className="brand-mark" aria-hidden="true"><CoatHanger size={22} weight="bold" /></span>
          <div>
            <h1>{t("Wardrobe")}</h1>
            <p>{t(MESSAGES[reason] || MESSAGES.setup)}</p>
          </div>
        </div>

        {showICloudOption && (
          <div className="segmented connect-mode" role="group" aria-label={t("Where your closet lives")}>
            <button type="button" className={mode === "server" ? "active" : ""} aria-pressed={mode === "server"} onClick={() => setMode("server")}>
              <HardDrives size={15} aria-hidden="true" /> {t("Own server")}
            </button>
            <button type="button" className={mode === "icloud" ? "active" : ""} aria-pressed={mode === "icloud"} onClick={() => setMode("icloud")}>
              <CloudCheck size={15} aria-hidden="true" /> {t("iCloud")}
            </button>
          </div>
        )}

        {showingICloud ? (
          <div className="connect-icloud">
            <strong><CloudCheck size={18} aria-hidden="true" /> {t("No server? Keep it in iCloud")}</strong>
            <p>{t("Your closet stays in your own iCloud and syncs to your iPhone and iPad. Nothing goes to us. AI calls go from this phone with your own key.")}</p>
            <button className="primary-button connect-submit" type="button" onClick={() => { setClosetMode("local"); window.location.reload(); }}>
              {t("Use iCloud")}
            </button>
            {window.__wardrobeLocalError && (
              <p className="status error" role="alert">
                <WarningCircle size={15} aria-hidden="true" /> {t("Could not open iCloud.")} {t(window.__wardrobeLocalError)}
              </p>
            )}
          </div>
        ) : (
          <>
            {native && reason !== "token" && (
              <div className="connect-needs">
                <strong>{t("What you need")}</strong>
                <ol>{NEEDS.map((need) => <li key={need}>{t(need)}</li>)}</ol>
                <a href={SETUP_GUIDE} target="_blank" rel="noreferrer">{t("How to set up a server")} <ArrowSquareOut size={14} aria-hidden="true" /></a>
              </div>
            )}

            {native && (
              <label className="field">
                <span>{t("Server address")}</span>
                <input
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={server}
                  onChange={(event) => { setServer(event.target.value); if (state.status === "failed") setState({ status: "idle" }); }}
                  placeholder="192.168.1.20:4173"
                  required
                />
                <small className="field-hint">{t("Enter your LAN IP:port or full HTTPS address.")}</small>
              </label>
            )}

            {native && (
              <>
                <p className="connect-presets-label">{t("Examples")}</p>
                <div className="connect-examples">
                  {EXAMPLES.map(({ icon: Icon, title, value }) => (
                    <button type="button" key={value} className="connect-example" onClick={() => applyExample(value)}>
                      <Icon size={18} aria-hidden="true" />
                      <span><strong>{t(title)}</strong><small>{value}</small></span>
                      {rtl ? <CaretLeft size={15} aria-hidden="true" /> : <CaretRight size={15} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className="field">
              <span>{t("Access token")}</span>
              <div className="password-row">
                <input
                  type={showToken ? "text" : "password"}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="current-password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={t("Your access token")}
                  required={reason === "token"}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowToken((current) => !current)}
                  aria-label={showToken ? t("Hide access token") : t("Show access token")}
                  aria-pressed={showToken}
                >
                  {showToken ? <EyeSlash size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
              {reason !== "token" && <small className="field-hint">{t("Leave empty if your server does not require a token.")}</small>}
            </label>

            {state.status === "failed" && (
              <p className="connect-status is-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {state.message}</p>
            )}
            {state.status === "ok" && (
              <p className="connect-status is-ok" role="status"><CheckCircle size={16} aria-hidden="true" /> {t("Connected. Opening your closet…")}</p>
            )}

            <button className="primary-button connect-submit" type="submit" disabled={busy} aria-busy={busy}>
              {state.status === "testing" ? <><SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> {t("Checking connection")}</> : t("Connect")}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
