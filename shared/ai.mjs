// AI calls shared by the local Node server and the Cloudflare Worker. The
// person picks Claude, ChatGPT (OpenAI) or Gemini in Settings and pastes an
// API key; keys can also come from the server environment. Nothing here may
// import Node modules.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYZE_PROMPT, ANALYZE_SCHEMA, STYLE_SCHEMA, buildStylePrompt, normalizeMetadata, normalizeStyledOutfits } from "./core.mjs";

export const AI_PROVIDERS = {
  claude: {
    name: "Claude",
    maker: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "WARDROBE_CLAUDE_MODEL",
    baseEnv: "ANTHROPIC_BASE_URL",
    defaultModel: "claude-opus-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    name: "ChatGPT",
    maker: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "WARDROBE_OPENAI_MODEL",
    baseEnv: "OPENAI_BASE_URL",
    defaultModel: "gpt-6.1-sol",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    name: "Gemini",
    maker: "Google",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "WARDROBE_GEMINI_MODEL",
    baseEnv: "GEMINI_BASE_URL",
    defaultModel: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
};
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS);

// The largest edge any of the three reads without shrinking the image itself
// (Claude's limit is the lowest).
export const AI_IMAGE_EDGE = 1568;

const MODEL_PATTERN = /^[\w.:/-]{1,100}$/;
const KEY_PATTERN = /^[\x21-\x7e]{8,400}$/;

export class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanStored(stored) {
  const value = stored && typeof stored === "object" ? stored : {};
  return {
    provider: AI_PROVIDERS[value.provider] ? value.provider : null,
    keys: value.keys && typeof value.keys === "object" ? value.keys : {},
    models: value.models && typeof value.models === "object" ? value.models : {},
  };
}

// stored: what Settings saved (or {}). env(name): reads a server setting.
function describe(id, stored, env) {
  const info = AI_PROVIDERS[id];
  const appKey = typeof stored.keys[id] === "string" ? stored.keys[id] : "";
  const serverKey = (env(info.keyEnv) || "").trim();
  const apiKey = appKey || serverKey;
  return {
    id,
    apiKey,
    keySource: appKey ? "app" : serverKey ? "server" : null,
    model: (typeof stored.models[id] === "string" && stored.models[id]) || env(info.modelEnv) || info.defaultModel,
    baseURL: env(info.baseEnv) || undefined,
  };
}

function selectedId(stored, env) {
  if (stored.provider) return stored.provider;
  const preferred = (env("WARDROBE_AI_PROVIDER") || "").trim().toLowerCase();
  if (AI_PROVIDERS[preferred]) return preferred;
  return AI_PROVIDER_IDS.find((id) => describe(id, stored, env).apiKey) || "claude";
}

// The provider, key and model the next AI call will use.
export function resolveAi(storedValue, env) {
  const stored = cleanStored(storedValue);
  return describe(selectedId(stored, env), stored, env);
}

// What the browser may see: never a whole key, only its last four characters.
export function publicAiSettings(storedValue, env) {
  const stored = cleanStored(storedValue);
  const provider = selectedId(stored, env);
  const providers = AI_PROVIDER_IDS.map((id) => {
    const { apiKey, keySource, model } = describe(id, stored, env);
    const info = AI_PROVIDERS[id];
    return {
      id,
      name: info.name,
      maker: info.maker,
      hasKey: Boolean(apiKey),
      keySource,
      keyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
      model,
      defaultModel: info.defaultModel,
      keyUrl: info.keyUrl,
    };
  });
  return { provider, ready: providers.find((entry) => entry.id === provider).hasKey, providers };
}

// Applies a change from Settings: { provider?, keys?: { id: "key" | null }, models?: { id: "model" | "" } }.
// A null or empty key removes the saved one; an empty model goes back to the default.
export function applyAiSettingsEdit(storedValue, input = {}) {
  const stored = cleanStored(storedValue);
  const next = { provider: stored.provider, keys: { ...stored.keys }, models: { ...stored.models } };
  if (input.provider !== undefined) {
    if (!AI_PROVIDERS[input.provider]) throw new AiError(400, `provider must be one of ${AI_PROVIDER_IDS.join(", ")}`);
    next.provider = input.provider;
  }
  for (const [field, pattern, label] of [["keys", KEY_PATTERN, "API key"], ["models", MODEL_PATTERN, "Model name"]]) {
    const changes = input[field];
    if (changes === undefined) continue;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new AiError(400, `${field} must be an object`);
    for (const [id, raw] of Object.entries(changes)) {
      if (!AI_PROVIDERS[id]) throw new AiError(400, `Unknown AI provider: ${id}`);
      const value = typeof raw === "string" ? raw.trim() : raw;
      if (value === null || value === "") { delete next[field][id]; continue; }
      if (typeof value !== "string" || !pattern.test(value)) throw new AiError(400, `${label} for ${AI_PROVIDERS[id].name} does not look right`);
      next[field][id] = value;
    }
  }
  return next;
}

// ---------- calls ----------

function setupError(ai) {
  const info = AI_PROVIDERS[ai.id];
  return new AiError(503, `Setup required: add your ${info.name} API key in Settings, or pick another AI there.`);
}

function parseJson(text, name) {
  if (!text) throw new Error(`${name} returned no answer`);
  try { return JSON.parse(text); } catch { throw new Error(`${name} returned an answer that was not JSON`); }
}

async function readError(response, name) {
  const text = await response.text().catch(() => "");
  let detail = "";
  try { const value = JSON.parse(text); detail = value.error?.message || value.message || ""; } catch { detail = text.slice(0, 200); }
  const status = response.status === 401 || response.status === 403 ? 502 : response.status === 429 ? 429 : 502;
  const hint = response.status === 401 || response.status === 403 ? " Check the API key in Settings." : "";
  return new AiError(status, `${name} said: ${detail || `HTTP ${response.status}`}.${hint}`);
}

async function askClaude(ai, { image, text, schema }) {
  const client = new Anthropic({ apiKey: ai.apiKey, ...(ai.baseURL ? { baseURL: ai.baseURL } : {}) });
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  content.push({ type: "text", text });
  const message = await client.beta.messages.create({
    model: ai.model,
    max_tokens: 16000,
    // If Claude declines, the API retries on the model Anthropic recommends.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this. Try another photo.");
  if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of room before finishing. Try again.");
  return parseJson(message.content.find((block) => block.type === "text")?.text, "Claude");
}

async function askOpenAi(ai, { image, text, schema, name }) {
  const content = [];
  if (image) content.push({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
  content.push({ type: "text", text });
  const response = await fetch(`${(ai.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  if (!response.ok) throw await readError(response, "ChatGPT");
  const choice = (await response.json()).choices?.[0];
  if (choice?.message?.refusal) throw new Error("ChatGPT declined to read this. Try another photo.");
  if (choice?.finish_reason === "length") throw new Error("ChatGPT ran out of room before finishing. Try again.");
  return parseJson(choice?.message?.content, "ChatGPT");
}

// Gemini's JSON schema support skips additionalProperties, so drop it.
function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "additionalProperties").map(([key, entry]) => [key, geminiSchema(entry)]));
}

async function askGemini(ai, { image, text, schema }) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
  parts.push({ text });
  const base = (ai.baseURL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const response = await fetch(`${base}/models/${encodeURIComponent(ai.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": ai.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: geminiSchema(schema) },
    }),
  });
  if (!response.ok) throw await readError(response, "Gemini");
  const value = await response.json();
  if (value.promptFeedback?.blockReason) throw new Error("Gemini declined to read this. Try another photo.");
  const candidate = value.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini ran out of room before finishing. Try again.");
  if (candidate?.finishReason === "SAFETY") throw new Error("Gemini declined to read this. Try another photo.");
  const answer = (candidate?.content?.parts || []).filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
  return parseJson(answer, "Gemini");
}

const ASK = { claude: askClaude, openai: askOpenAi, gemini: askGemini };

// Throws the "add a key in Settings" error when the picked AI has no key.
export function requireAi(ai) {
  if (!ai?.apiKey) throw setupError(ai?.id ? ai : { id: "claude" });
  return ai;
}

async function askForJson(ai, request) {
  requireAi(ai);
  try {
    return await ASK[ai.id](ai, request);
  } catch (error) {
    // A rejected key must not look like a rejected wardrobe token (401 signs the app out).
    if (!(error instanceof AiError) && (error.status === 401 || error.status === 403)) {
      throw new AiError(502, `${AI_PROVIDERS[ai.id].name} did not accept the API key. Check it in Settings.`);
    }
    throw error;
  }
}

// Finds each piece of clothing in a photo. imageBase64 should be a JPEG or PNG
// no larger than AI_IMAGE_EDGE on its long edge.
export async function detectClothing(ai, { imageBase64, mediaType = "image/jpeg" }) {
  const result = await askForJson(ai, { name: "clothing", schema: ANALYZE_SCHEMA, text: ANALYZE_PROMPT, image: { base64: imageBase64, mediaType } });
  if (!Array.isArray(result.items)) throw new Error(`${AI_PROVIDERS[ai.id].name} returned an invalid clothing list`);
  return result.items.slice(0, 8).map(normalizeMetadata);
}

// Picks new outfits from the pieces already in the wardrobe.
export async function styleOutfits(ai, { items, outfits = [], count = 4, notes = "" }) {
  const result = await askForJson(ai, { name: "outfits", schema: STYLE_SCHEMA, text: buildStylePrompt({ items, outfits, count, notes }) });
  return normalizeStyledOutfits(result, items, outfits).slice(0, count);
}
