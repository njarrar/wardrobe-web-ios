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

test("an AI that never answers is given up on, with a plain message", async () => {
  const ai = { id: "gemini", apiKey: "AIza-test", model: "gemini-test", retryWait: 0, timeout: 40, fetch: () => new Promise(() => {}) };
  const started = Date.now();
  await assert.rejects(detectClothing(ai, { imageBase64: "AAAA" }), /Gemini took too long to answer\. Your photo was not read/);
  assert.ok(Date.now() - started < 2000);
});

test("a used-up daily limit is said in plain words, and is not tried again", async () => {
  const message = "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-test, description: Generate requests per day limit exceeded on Free Tier. Please retry in 10h6m39.462977131s.";
  const { ai, calls } = gemini([() => new Response(JSON.stringify({ error: { message } }), { status: 429 })]);
  await assert.rejects(detectClothing(ai, { imageBase64: "AAAA" }), (error) => {
    assert.equal(error.message, "Your Gemini key has used up its daily limit on the free plan. Your photo was not read. Try again in about 10 hours, or pick another AI in Settings.");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("too many requests in a minute is tried again, then said plainly", async () => {
  const slow = () => new Response(JSON.stringify({ error: { message: "Rate limit reached. Please retry in 21s." } }), { status: 429 });
  const { ai, calls } = gemini([slow, slow, slow]);
  await assert.rejects(detectClothing(ai, { imageBase64: "AAAA" }), /Gemini is getting too many requests\. Your photo was not read\. Try again in a minute, or pick another AI/);
  assert.equal(calls.length, 3);
});
