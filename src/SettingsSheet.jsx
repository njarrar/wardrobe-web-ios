import { useEffect, useState } from "react";
import { CheckCircle, CloudCheck, HardDrives, SignOut, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import { accessToken, connectionLabel, forgetConnection, isNativeApp, serverUrl, testConnection } from "./api.js";

// Where the closet lives and how this device is connected to it.
export function SettingsSheet({ onClose, pieces }) {
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
  const storage = config.storage === "cloudflare" ? "Cloudflare (R2 + D1)" : "Server disk (e.g. your NAS volume)";
  const version = status.server?.version;

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2 id="settings-title">Your wardrobe server</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings"><X size={20} aria-hidden="true" /></button>
        </header>

        <div className="settings-card">
          <span className="settings-card__icon" aria-hidden="true">
            {config.storage === "cloudflare" ? <CloudCheck size={22} /> : <HardDrives size={22} />}
          </span>
          <div className="settings-card__body">
            <strong>{connectionLabel() || "This server"}</strong>
            <span className={`settings-status is-${status.state}`}>
              {status.state === "checking" && <><SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> Checking…</>}
              {status.state === "ok" && <><CheckCircle size={14} weight="fill" aria-hidden="true" /> Connected</>}
              {status.state === "failed" && <><WarningCircle size={14} weight="fill" aria-hidden="true" /> {status.reason === "token" ? "Token not accepted" : "Not reachable"}</>}
            </span>
          </div>
        </div>

        <dl className="settings-list">
          <div><dt>Pieces</dt><dd>{pieces}</dd></div>
          <div><dt>Photos stored on</dt><dd>{status.state === "ok" ? storage : "—"}</dd></div>
          <div><dt>AI styling</dt><dd>{status.state !== "ok" ? "—" : config.ready ? "Ready" : "Needs ANTHROPIC_API_KEY"}</dd></div>
          <div><dt>Protected by token</dt><dd>{accessToken() ? "Yes" : "No"}</dd></div>
          {version && <div><dt>Server version</dt><dd>{version}</dd></div>}
        </dl>

        <div className="settings-actions">
          {native && (
            <button className="secondary-button" type="button" onClick={switchServer}>
              <HardDrives size={16} aria-hidden="true" /> Switch server
            </button>
          )}
          {accessToken() && (
            <button className="secondary-button danger" type="button" onClick={signOut}>
              <SignOut size={16} aria-hidden="true" /> Forget token
            </button>
          )}
        </div>

        <p className="settings-note">
          {native
            ? "Tip: at home, connect straight to your NAS (http://NAS-IP:4173). Away from home, use an HTTPS address from DSM's reverse proxy with a Synology DDNS name, or Tailscale."
            : "Everything you add is saved on this server. Open the same address from any browser, or connect the iPhone app to it."}
        </p>
      </section>
    </div>
  );
}
