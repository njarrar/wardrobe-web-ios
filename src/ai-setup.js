import { useEffect, useState } from "react";
import { AI_CHANGED_EVENT, apiFetch } from "./api.js";

// Which AI the server uses and whether it has a key. Reloads when Settings
// switches the AI or changes its key.
export function useAiSetup() {
  const [setup, setSetup] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => apiFetch("/api/import/config")
      .then(async (response) => {
        const value = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(value.error || "Could not check the AI settings.");
        return value;
      })
      .then((value) => { if (live) setSetup(value); })
      .catch((error) => { if (live) setSetup({ ready: false, error: error.message }); });
    load();
    window.addEventListener(AI_CHANGED_EVENT, load);
    return () => { live = false; window.removeEventListener(AI_CHANGED_EVENT, load); };
  }, []);
  return setup;
}

// The company behind each AI, and where its privacy policy lives.
export const AI_COMPANIES = {
  claude: { company: "Anthropic", privacy: "https://www.anthropic.com/legal/privacy" },
  openai: { company: "OpenAI", privacy: "https://openai.com/policies/privacy-policy" },
  gemini: { company: "Google", privacy: "https://policies.google.com/privacy" },
};

// People agree once per AI on each device, before any photo is sent to it.
const CONSENT_KEY = "wardrobe-ai-consent";
const ASK_EVENT = "wardrobe:ask-ai-consent";

function readConsent() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}") || {}; } catch { return {}; }
}

export function hasAiConsent(provider) {
  return Boolean(provider && readConsent()[provider]);
}

export function saveAiConsent(provider, allowed) {
  const consent = readConsent();
  if (allowed) consent[provider] = new Date().toISOString();
  else delete consent[provider];
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* storage unavailable */ }
}

// Resolves true once the person allows it, false if they say no. The
// AiConsentPrompt in App shows the question.
export function askAiConsent(setup) {
  const provider = setup?.provider;
  if (!provider) return Promise.resolve(false);
  if (hasAiConsent(provider)) return Promise.resolve(true);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { provider, name: setup.providerName || provider, resolve } }));
  });
}

export const AI_CONSENT_ASK_EVENT = ASK_EVENT;
