// AI calls shared by the local Node server and the Cloudflare Worker. The
// person picks Claude, ChatGPT (OpenAI) or Gemini in Settings and pastes an
// API key; keys can also come from the server environment. Nothing here may
// import Node modules.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYZE_PROMPT, ANALYZE_SCHEMA, MAX_STYLE_COUNT, SORT_SCHEMA, STYLE_SCHEMA, buildSortPrompt, buildStylePrompt, normalizeMetadata, normalizeStyledOutfits, sortFields } from "./core.mjs";
import { colorHarmony, outfitColors } from "./style.mjs";

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

const MODEL_PATTERN = /^(?!.*\.\.)(?!\/)[\w.:/-]{1,100}$/;
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
  const rawRetry = env("WARDROBE_AI_RETRY_MS");
  const parsedRetry = rawRetry !== undefined && rawRetry !== null && String(rawRetry).trim() !== "" ? Number(rawRetry) : NaN;
  const retryWait = Number.isFinite(parsedRetry) && parsedRetry >= 0 ? parsedRetry : undefined;
  const rawTimeout = Number(env("WARDROBE_AI_TIMEOUT_MS"));
  return {
    id,
    apiKey,
    keySource: appKey ? "app" : serverKey ? "server" : null,
    model: (typeof stored.models[id] === "string" && stored.models[id]) || env(info.modelEnv) || info.defaultModel,
    baseURL: env(info.baseEnv) || undefined,
    // First wait before a busy AI is tried again (tests set it to 0).
    retryWait,
    timeout: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : undefined,
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
  if (!text || typeof text !== "string") throw new Error(`${name} returned no answer`);
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) cleaned = fence[1].trim();
  if (!cleaned) throw new Error(`${name} returned no answer`);
  try { return JSON.parse(cleaned); } catch { throw new Error(`${name} returned an answer that was not JSON`); }
}

// The AI is busy or briefly down: worth another try.
const BUSY = new Set([429, 500, 502, 503, 504, 529]);

// A key that has used up its plan: waiting a second will not help.
const QUOTA = /quota|per day|billing|credit balance|insufficient/i;

const MAX_RETRY_AFTER_MS = 10000;

function readHeader(headers, key) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(key);
  const target = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === target) return v;
  return null;
}

// Parses Retry-After as either delta-seconds or an RFC 9110 HTTP-date.
function parseRetryAfterSeconds(headers) {
  const raw = readHeader(headers, "retry-after");
  if (raw === null || raw === undefined || String(raw).trim() === "") return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(String(raw));
  if (Number.isFinite(parsed)) return Math.max(0, (parsed - Date.now()) / 1000);
  return 0;
}

function notDoneSentence(op = "photo") {
  if (op === "outfits") return "No outfits were styled.";
  if (op === "sort") return "Your closet was not sorted.";
  return "Your photo was not read.";
}

function declinedMessage(name, op = "photo") {
  if (op === "outfits") return `${name} declined to style these outfits. Try adjusting your notes.`;
  if (op === "sort") return `${name} declined to sort these pieces. Try again.`;
  return `${name} declined to read this. Try another photo.`;
}

// "10h6m39.4s" or a Retry-After header (seconds or HTTP-date), as plain words.
function waitWords(detail, headers) {
  const match = /retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(detail || "");
  let seconds = match && match[0].trim().length > 8 ? (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0) : 0;
  if (!seconds) seconds = parseRetryAfterSeconds(headers);
  if (seconds >= 5400) return ` Try again in about ${Math.round(seconds / 3600)} hours`;
  if (seconds >= 3600) return " Try again in about an hour";
  if (seconds >= 120) return ` Try again in about ${Math.round(seconds / 60)} minutes`;
  if (seconds > 0) return " Try again in a minute";
  return " Try again later";
}

function extractDetail(text) {
  if (!text) return "";
  try { const value = JSON.parse(text); return value.error?.message || value.message || ""; } catch { return text; }
}

function formatApiError(httpStatus, textOrDetail, headers, name, op = "photo") {
  const detail = extractDetail(textOrDetail);
  const notDone = notDoneSentence(op);
  const status = httpStatus === 401 || httpStatus === 403 ? 502 : httpStatus === 429 ? 429 : 502;
  if (httpStatus === 503 || httpStatus === 529) return new AiError(status, `${name} is busy right now. ${notDone} Try again in a minute, or pick another AI in Settings.`);
  if (httpStatus === 429 && QUOTA.test(detail)) {
    const limit = /per day|daily/i.test(detail) ? "daily limit" : "limit";
    const free = /free tier/i.test(detail) ? " on the free plan" : "";
    return new AiError(429, `Your ${name} key has used up its ${limit}${free}. ${notDone}${waitWords(detail, headers)}, or pick another AI in Settings.`);
  }
  if (httpStatus === 429) return new AiError(429, `${name} is getting too many requests. ${notDone}${waitWords(detail, headers)}, or pick another AI in Settings.`);
  const hint = httpStatus === 401 || httpStatus === 403 ? " Check the API key in Settings." : "";
  const short = detail.length > 200 ? `${detail.slice(0, 200).trim()}…` : detail.replace(/\.+$/, "");
  return new AiError(status, `${name} said: ${short || `HTTP ${httpStatus}`}.${hint}`);
}

function retryDelayMs(wait, attempt, headers) {
  const headerSeconds = parseRetryAfterSeconds(headers);
  if (headerSeconds > 0) return Math.min(MAX_RETRY_AFTER_MS, Math.round(headerSeconds * 1000));
  return wait * (attempt * 2 + 1);
}

function isAbortError(error, signal) {
  return Boolean(signal?.aborted || error?.name === "AbortError");
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener?.("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// Sends the request, and tries twice more when the AI is busy or a transient
// network error happens. Reads error bodies at most once (no response.clone()).
async function post(ai, url, init, signal) {
  const send = ai.fetch || fetch;
  const wait = ai.retryWait ?? 1500;
  const requestInit = signal ? { ...init, signal } : init;
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await send(url, requestInit);
    } catch (error) {
      if (attempt === 2 || isAbortError(error, signal)) throw error;
      await sleep(wait * (attempt * 2 + 1), signal);
      continue;
    }
    if (response.ok) return { ok: true, status: response.status, headers: response.headers, response };
    const text = await response.text().catch(() => "");
    if (attempt === 2 || !BUSY.has(response.status) || (response.status === 429 && QUOTA.test(text))) {
      return { ok: false, status: response.status, headers: response.headers, text };
    }
    await sleep(retryDelayMs(wait, attempt, response.headers), signal);
  }
}

function isUnsupportedParamError(error) {
  if (error?.status !== 400) return false;
  const msg = String(error?.error?.error?.message || error?.message || "").toLowerCase();
  return /beta|thinking|fallback|output_config|extra inputs|unrecognized|not supported|invalid.*param|unknown.*field/.test(msg);
}

function mapClaudeSdkError(error, op) {
  if (error instanceof AiError) return error;
  const status = error?.status;
  if (typeof status === "number" && status >= 400) {
    const detail = error?.error?.error?.message || error?.error?.message || error?.message || "";
    return formatApiError(status, detail, error?.headers, "Claude", op);
  }
  return error;
}

async function askClaude(ai, { image, text, schema, op = "photo", maxTokens = 8192 }, signal) {
  // ai.fetch: the phone app passes its own fetch when it calls the AI itself.
  const client = new Anthropic({
    apiKey: ai.apiKey,
    maxRetries: 0,
    ...(ai.baseURL ? { baseURL: ai.baseURL } : {}),
    ...(ai.fetch ? { fetch: ai.fetch, dangerouslyAllowBrowser: true } : {}),
  });
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  content.push({ type: "text", text });
  const wait = ai.retryWait ?? 1500;
  const reqOpts = signal ? { signal } : {};

  const invoke = async (mode) => {
    if (mode === "beta") {
      return client.beta.messages.create({
        model: ai.model,
        max_tokens: Math.max(maxTokens, 16000),
        // If Claude declines, the API retries on the model Anthropic recommends.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }],
      }, reqOpts);
    }
    if (mode === "standard") {
      return client.messages.create({
        model: ai.model,
        max_tokens: maxTokens,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }],
      }, reqOpts);
    }
    return client.messages.create({
      model: ai.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [...content, { type: "text", text: "Return only valid JSON matching the requested schema." }] }],
    }, reqOpts);
  };

  let mode = "beta";
  let message;
  for (let attempt = 0; ; attempt += 1) {
    try {
      message = await invoke(mode);
      break;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if (isUnsupportedParamError(error) && mode !== "plain") {
        mode = mode === "beta" ? "standard" : "plain";
        attempt -= 1;
        continue;
      }
      const status = error?.status;
      const detail = error?.error?.error?.message || error?.error?.message || error?.message || "";
      const retryableStatus = typeof status === "number" && BUSY.has(status) && !(status === 429 && QUOTA.test(detail));
      const retryableNet = status === undefined && error?.name !== "AbortError";
      if (attempt < 2 && (retryableStatus || retryableNet)) {
        await sleep(retryDelayMs(wait, attempt, error?.headers), signal);
        continue;
      }
      throw mapClaudeSdkError(error, op);
    }
  }
  if (message.stop_reason === "refusal") throw new Error(declinedMessage("Claude", op));
  if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of room before finishing. Try again.");
  const answer = (message.content || []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  return parseJson(answer, "Claude");
}

async function askOpenAi(ai, { image, text, schema, name, op = "photo", maxTokens = 8192 }, signal) {
  const content = [];
  if (image) content.push({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
  content.push({ type: "text", text });
  const res = await post(ai, `${(ai.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  }, signal);
  if (!res.ok) throw formatApiError(res.status, res.text, res.headers, "ChatGPT", op);
  const choice = (await res.response.json()).choices?.[0];
  if (choice?.message?.refusal) throw new Error(declinedMessage("ChatGPT", op));
  if (choice?.finish_reason === "length") throw new Error("ChatGPT ran out of room before finishing. Try again.");
  return parseJson(choice?.message?.content, "ChatGPT");
}

// Gemini's JSON schema support skips additionalProperties, so drop it.
function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "additionalProperties").map(([key, entry]) => [key, geminiSchema(entry)]));
}

// Older Gemini models expect OpenAPI-style responseSchema (nullable instead of anyOf:[..., null]).
function geminiLegacySchema(value) {
  if (Array.isArray(value)) return value.map(geminiLegacySchema);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.anyOf)) {
    const nonNull = value.anyOf.find((entry) => entry?.type && entry.type !== "null");
    const hasNull = value.anyOf.some((entry) => entry?.type === "null");
    if (nonNull) return { ...geminiLegacySchema(nonNull), ...(hasNull ? { nullable: true } : {}) };
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "additionalProperties").map(([key, entry]) => [key, geminiLegacySchema(entry)]));
}

const GEMINI_DECLINED_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "RECITATION",
  "IMAGE_RECITATION",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

async function askGemini(ai, { image, text, schema, op = "photo", maxTokens = 8192 }, signal) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
  parts.push({ text });
  const base = (ai.baseURL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const modelId = String(ai.model || "").replace(/^models\//i, "");
  const url = `${base}/models/${encodeURIComponent(modelId)}:generateContent`;
  const sendBody = (generationConfig) => post(ai, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": ai.apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
  }, signal);

  let res = await sendBody({ responseMimeType: "application/json", responseJsonSchema: geminiSchema(schema), maxOutputTokens: maxTokens });
  if (!res.ok && res.status === 400 && /responseJsonSchema|unknown name|cannot find field/i.test(res.text || "")) {
    res = await sendBody({ responseMimeType: "application/json", responseSchema: geminiLegacySchema(schema), maxOutputTokens: maxTokens });
  }
  if (!res.ok) throw formatApiError(res.status, res.text, res.headers, "Gemini", op);
  const value = await res.response.json();
  if (value.promptFeedback?.blockReason) throw new Error(declinedMessage("Gemini", op));
  const candidate = value.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === "MAX_TOKENS") throw new Error("Gemini ran out of room before finishing. Try again.");
  if (GEMINI_DECLINED_REASONS.has(finishReason)) throw new Error(declinedMessage("Gemini", op));
  const answer = (candidate?.content?.parts || []).filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
  if (!answer && finishReason && finishReason !== "STOP") {
    throw new Error(`Gemini stopped early (${finishReason}). ${notDoneSentence(op)} Try again.`);
  }
  return parseJson(answer, "Gemini");
}

const ASK = { claude: askClaude, openai: askOpenAi, gemini: askGemini };

// Throws the "add a key in Settings" error when the picked AI has no key.
export function requireAi(ai) {
  if (!ai?.apiKey) throw setupError(ai?.id ? ai : { id: "claude" });
  return ai;
}

// How long one AI request may take, retries included.
export const AI_TIMEOUT_MS = 120000;

async function askForJson(ai, request) {
  requireAi(ai);
  const op = request.op || "photo";
  try {
    // An AI that never answers must not hold the import forever.
    const limit = ai.timeout ?? AI_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutError = new AiError(504, `${AI_PROVIDERS[ai.id].name} took too long to answer. ${notDoneSentence(op)} Try again, or pick another AI in Settings.`);
    let timer;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, limit);
    });
    const task = ASK[ai.id](ai, request, controller.signal);
    task.catch(() => {}); // prevent unhandled rejection if timeout wins race
    try { return await Promise.race([task, late]); } finally { clearTimeout(timer); }
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
  const result = await askForJson(ai, { name: "clothing", op: "photo", maxTokens: 4096, schema: ANALYZE_SCHEMA, text: ANALYZE_PROMPT, image: { base64: imageBase64, mediaType } });
  if (!Array.isArray(result.items)) throw new Error(`${AI_PROVIDERS[ai.id].name} returned an invalid clothing list`);
  return result.items.slice(0, 8).map(normalizeMetadata);
}

// Picks new outfits from the pieces already in the wardrobe.
// A single accent on neutrals is as calm as a tonal look.
function fitsRule(found, wanted) {
  return found === wanted || (wanted === "tonal" && found === "accent");
}

// Each outfit is checked on the color wheel here, so a clash never slips
// through and the asked-for rule comes first.
export async function styleOutfits(ai, { items, outfits = [], count = 4, notes = "", rule = "", preferIds = [] }) {
  const askCount = Math.min(MAX_STYLE_COUNT, count + 2);
  const result = await askForJson(ai, { name: "outfits", op: "outfits", maxTokens: 8192, schema: STYLE_SCHEMA, text: buildStylePrompt({ items, outfits, count: askCount, notes, rule, preferIds }) });
  const byId = new Map(items.map((item) => [item.id, item]));
  return normalizeStyledOutfits(result, items, outfits)
    .map((outfit) => ({ outfit, harmony: colorHarmony(outfitColors(outfit, byId)) }))
    .filter(({ harmony }) => harmony.score >= 45)
    .sort((a, b) => (rule ? Number(fitsRule(b.harmony.rule, rule)) - Number(fitsRule(a.harmony.rule, rule)) : 0) || b.harmony.score - a.harmony.score)
    .slice(0, count)
    .map(({ outfit }) => outfit);
}

// Fills in kind, seasons, warmth, dress level and pattern for pieces added before 2.5.
// Only names, colors and tags are sent, never photos. Returns { id, ...fields }.
export async function sortCloset(ai, items) {
  const results = [];
  for (let start = 0; start < items.length; start += 60) {
    const batch = items.slice(start, start + 60);
    const known = new Set(batch.map((item) => item.id));
    let value;
    try {
      value = await askForJson(ai, { name: "sorted", op: "sort", maxTokens: 8192, schema: SORT_SCHEMA, text: buildSortPrompt(batch) });
    } catch (error) {
      if (results.length > 0) break;
      throw error;
    }
    for (const entry of Array.isArray(value?.items) ? value.items : []) {
      if (known.delete(entry?.id)) results.push({ id: entry.id, ...sortFields(entry) });
    }
  }
  return results;
}
