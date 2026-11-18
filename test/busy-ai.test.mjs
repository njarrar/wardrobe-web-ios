import assert from "node:assert/strict";
import { test } from "node:test";
import { detectClothing } from "../shared/ai.mjs";

const answer = { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [] }) }] } }] };
const busy = () => new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 });

function gemini(replies) {
  const calls = [];
  return { calls, ai: { id: "gemini", apiKey: "AIza-test", model: "gemini-test", retryWait: 0, fetch: async (url) => { calls.push(url); return replies.shift()(); } } };
}

test("a busy AI is tried again and the photo is read", async () => {
  const { ai, calls } = gemini([busy, busy, () => new Response(JSON.stringify(answer), { status: 200 })]);
  await detectClothing(ai, { imageBase64: "AAAA" });
  assert.equal(calls.length, 3);
});

test("after three busy answers the message says what to do", async () => {
  const { ai, calls } = gemini([busy, busy, busy]);
  await assert.rejects(detectClothing(ai, { imageBase64: "AAAA" }), /Gemini is busy right now\. Your photo was not read\. Try again in a minute/);
  assert.equal(calls.length, 3);
});

test("a rejected key is not tried again", async () => {
  const { ai, calls } = gemini([() => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 403 })]);
  await assert.rejects(detectClothing(ai, { imageBase64: "AAAA" }), /Check the API key/);
  assert.equal(calls.length, 1);
});
