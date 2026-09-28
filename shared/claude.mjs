// Claude calls shared by the local Node server and the Cloudflare Worker.
// Both pass in an Anthropic client, so this file stays free of Node modules.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYZE_PROMPT, ANALYZE_SCHEMA, STYLE_SCHEMA, buildStylePrompt, normalizeMetadata, normalizeStyledOutfits } from "./core.mjs";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
// The largest edge Claude reads without shrinking the image itself.
export const CLAUDE_IMAGE_EDGE = 1568;

export function createClaude({ apiKey, baseURL }) {
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

async function askForJson(client, { model, content, schema, maxTokens = 16000 }) {
  const message = await client.beta.messages.create({
    model: model || DEFAULT_CLAUDE_MODEL,
    max_tokens: maxTokens,
    // If Claude declines, the API retries on the model Anthropic recommends.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this photo. Try another one.");
  if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of room before finishing. Try again.");
  const text = message.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned no answer");
  try { return JSON.parse(text); } catch { throw new Error("Claude returned an answer that was not JSON"); }
}

// Finds each piece of clothing in a photo. imageBase64 should be a JPEG or PNG
// no larger than CLAUDE_IMAGE_EDGE on its long edge.
export async function detectClothing(client, { model, imageBase64, mediaType = "image/jpeg" }) {
  const result = await askForJson(client, {
    model,
    schema: ANALYZE_SCHEMA,
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      { type: "text", text: ANALYZE_PROMPT },
    ],
  });
  if (!Array.isArray(result.items)) throw new Error("Claude returned an invalid clothing list");
  return result.items.slice(0, 8).map(normalizeMetadata);
}

// Picks new outfits from the pieces already in the wardrobe.
export async function styleOutfits(client, { model, items, outfits = [], count = 4, notes = "" }) {
  const result = await askForJson(client, {
    model,
    schema: STYLE_SCHEMA,
    content: [{ type: "text", text: buildStylePrompt({ items, outfits, count, notes }) }],
  });
  return normalizeStyledOutfits(result, items, outfits).slice(0, count);
}
