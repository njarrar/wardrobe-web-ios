import { useState } from "react";
import { ArrowSquareOut, CheckCircle, CoatHanger, Globe, HardDrives, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { accessToken, isNativeApp, normalizeServerUrl, saveConnection, serverUrl, testConnection } from "./api.js";

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

export function ConnectScreen({ reason }) {
  const native = isNativeApp();
  const [server, setServer] = useState(serverUrl() || "");
  const [token, setToken] = useState(accessToken());
  const [state, setState] = useState({ status: "idle" });

  const submit = async (event) => {
    event.preventDefault();
    setState({ status: "testing" });
    const target = native ? normalizeServerUrl(server) : "";
    const result = await testConnection({ server: target, token });
    if (!result.ok) {
      setState({ status: "failed", message: FAILURES[result.reason] || FAILURES.server });
      return;
    }
    setState({ status: "ok" });
    saveConnection({ server: native ? target : undefined, token });
    setTimeout(() => window.location.reload(), 350);
  };

  const busy = state.status === "testing" || state.status === "ok";

  return (
    <main className="connect-screen">
      <div className="connect-glow" aria-hidden="true" />
      <form className="connect-card" onSubmit={submit}>
        <div className="connect-brand">
          <span className="brand-mark" aria-hidden="true"><CoatHanger size={22} weight="bold" /></span>
          <div>
            <h1>Wardrobe</h1>
            <p>{MESSAGES[reason] || MESSAGES.setup}</p>
          </div>
        </div>

        {native && reason !== "token" && (
          <div className="connect-needs">
            <strong>What you need</strong>
            <ol>{NEEDS.map((need) => <li key={need}>{need}</li>)}</ol>
            <a href={SETUP_GUIDE} target="_blank" rel="noreferrer">How to set up a server <ArrowSquareOut size={14} aria-hidden="true" /></a>
          </div>
        )}

        {native && (
          <label className="field">
            <span>Server address</span>
            <input
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder="192.168.1.20:4173"
              required
            />
          </label>
        )}

        {native && (
          <div className="connect-examples">
            {EXAMPLES.map(({ icon: Icon, title, value }) => (
              <button type="button" key={value} className="connect-example" onClick={() => setServer(value)}>
                <Icon size={18} aria-hidden="true" />
                <span><strong>{title}</strong><small>{value}</small></span>
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Access token</span>
          <input
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Your access token"
            required={native || reason === "token"}
          />
        </label>

        {state.status === "failed" && (
          <p className="connect-status is-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {state.message}</p>
        )}
        {state.status === "ok" && (
          <p className="connect-status is-ok" role="status"><CheckCircle size={16} aria-hidden="true" /> Connected. Opening your closet…</p>
        )}

        <button className="primary-button connect-submit" type="submit" disabled={busy}>
          {state.status === "testing" ? <><SpinnerGap size={16} className="import-spinner" aria-hidden="true" /> Checking connection</> : "Connect"}
        </button>
      </form>
    </main>
  );
}
