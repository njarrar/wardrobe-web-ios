import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { AI_COMPANIES, AI_CONSENT_ASK_EVENT, saveAiConsent } from "./ai-setup.js";
import { t } from "./i18n.js";
import { isLocalMode } from "./local/mode.js";
import { useDialog } from "./dialog.js";

// Asks once, before any photo goes to the AI picked in Settings.
// Queues and coalesces concurrent requests by provider so no Promise hangs (#116).
export function AiConsentPrompt() {
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  queueRef.current = queue;
  const sheetRef = useRef(null);
  const declineRef = useRef(null);

  useEffect(() => {
    const onAsk = (event) => {
      const detail = event.detail;
      if (!detail || !detail.provider || typeof detail.resolve !== "function") return;
      setQueue((current) => {
        const existingIndex = current.findIndex((entry) => entry.provider === detail.provider);
        if (existingIndex !== -1) {
          return current.map((entry, idx) => (
            idx === existingIndex
              ? { ...entry, resolvers: [...entry.resolvers, detail.resolve] }
              : entry
          ));
        }
        return [...current, { provider: detail.provider, name: detail.name, resolvers: [detail.resolve] }];
      });
    };
    window.addEventListener(AI_CONSENT_ASK_EVENT, onAsk);
    return () => {
      window.removeEventListener(AI_CONSENT_ASK_EVENT, onAsk);
      // Resolve any remaining waiters cleanly if unmounted.
      for (const entry of queueRef.current) {
        for (const resolve of entry.resolvers) resolve(false);
      }
    };
  }, []);

  const ask = queue[0] || null;

  const answer = useCallback((allowed) => {
    const current = queueRef.current[0];
    if (!current) return;
    if (allowed) saveAiConsent(current.provider, true);
    for (const resolve of current.resolvers) resolve(allowed);
    setQueue((list) => list.slice(1));
  }, []);

  const decline = useCallback(() => answer(false), [answer]);

  // Focus "Not now" on open and map Escape to decline (#055).
  useDialog({
    open: Boolean(ask),
    onClose: decline,
    initialFocusRef: declineRef,
    containerRef: sheetRef,
  });

  if (!ask) return null;
  const { company, privacy } = AI_COMPANIES[ask.provider] || { company: ask.name };

  return (
    <div className="viewer-overlay sheet-overlay consent-overlay" role="presentation">
      <section ref={sheetRef} className="settings-sheet consent-sheet" role="alertdialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body">
        <span className="consent-sheet__icon" aria-hidden="true"><ShieldCheck size={26} /></span>
        <h2 id="consent-title">{t("Send your photos to {name}?", { name: ask.name })}</h2>
        <div id="consent-body" className="consent-sheet__body">
          <p>{t(isLocalMode() ? "To find each piece and style outfits, this device sends {company} the clothing photos you add and the names, colors and tags of your pieces." : "To find each piece and style outfits, your server sends {company} the clothing photos you add and the names, colors and tags of your pieces.", { company })}</p>
          <p>{t("{company} handles them under its own rules", { company })}{privacy ? <> (<a href={privacy} target="_blank" rel="noreferrer">{t("privacy policy")}</a>)</> : null}. {t("Nothing goes to {company} until you agree. You can switch AI in Settings at any time.", { company })}</p>
        </div>
        <div className="consent-sheet__actions">
          <button ref={declineRef} className="secondary-button" type="button" onClick={() => answer(false)}>{t("Not now")}</button>
          <button className="primary-button" type="button" onClick={() => answer(true)}>{t("Allow")}</button>
        </div>
      </section>
    </div>
  );
}
