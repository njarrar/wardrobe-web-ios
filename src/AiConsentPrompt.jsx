import { useEffect, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { AI_COMPANIES, AI_CONSENT_ASK_EVENT, saveAiConsent } from "./ai-setup.js";

// Asks once, before any photo goes to the AI picked in Settings.
export function AiConsentPrompt() {
  const [ask, setAsk] = useState(null);

  useEffect(() => {
    const onAsk = (event) => setAsk(event.detail);
    window.addEventListener(AI_CONSENT_ASK_EVENT, onAsk);
    return () => window.removeEventListener(AI_CONSENT_ASK_EVENT, onAsk);
  }, []);

  if (!ask) return null;
  const { company, privacy } = AI_COMPANIES[ask.provider] || { company: ask.name };
  const answer = (allowed) => {
    if (allowed) saveAiConsent(ask.provider, true);
    ask.resolve(allowed);
    setAsk(null);
  };

  return (
    <div className="viewer-overlay sheet-overlay consent-overlay" role="presentation">
      <section className="settings-sheet consent-sheet" role="alertdialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body">
        <span className="consent-sheet__icon" aria-hidden="true"><ShieldCheck size={26} /></span>
        <h2 id="consent-title">Send your photos to {ask.name}?</h2>
        <div id="consent-body" className="consent-sheet__body">
          <p>To find each piece and style outfits, your server sends {company} the clothing photos you add and the names, colors and tags of your pieces.</p>
          <p>{company} handles them under its own rules{privacy ? <> (<a href={privacy} target="_blank" rel="noreferrer">privacy policy</a>)</> : null}. Nothing goes to {company} until you agree. You can switch AI in Settings at any time.</p>
        </div>
        <div className="consent-sheet__actions">
          <button className="secondary-button" type="button" onClick={() => answer(false)}>Not now</button>
          <button className="primary-button" type="button" onClick={() => answer(true)} autoFocus>Allow</button>
        </div>
      </section>
    </div>
  );
}
