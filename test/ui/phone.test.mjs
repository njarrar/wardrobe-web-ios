// Opens the built app on a phone-sized screen and walks the main screens.
// Run `npm run build` first, then `npm run test:ui`. Set SCREENSHOT_DIR to
// save a picture of each screen.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shots = process.env.SCREENSHOT_DIR;

const PIECES = [
  ["White oxford shirt", "upperbody", "#f1efea"],
  ["Navy chinos", "lowerbody", "#34528f"],
  ["Black denim jacket", "wholebody_up", "#1f1f1f"],
  ["Brown loafers", "shoes", "#7a5134"],
  ["Olive tee", "upperbody", "#5f7a45"],
  ["Beige trench", "wholebody_up", "#d6c4a3"],
];

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function seed(dataDir) {
  const imported = path.join(dataDir, "imported");
  await mkdir(imported, { recursive: true });
  const records = [];
  for (const [index, [name, part, color]] of PIECES.entries()) {
    const file = `seed-${index}.png`;
    const shape = `<svg width="600" height="600"><rect x="120" y="80" width="360" height="440" rx="60" fill="${color}" stroke="#999"/></svg>`;
    await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(shape) }]).png().toFile(path.join(imported, file));
    records.push({ id: `seed-${index}`, name, part, color, palette: [color], tags: ["casual"], image: `/api/import/library/${file}`, thumbnail: `/api/import/library/${file}`, addedAt: new Date(2026, 0, index + 1).toISOString() });
  }
  await writeFile(path.join(dataDir, "library.json"), JSON.stringify(records));
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Server stopped before it started");
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start");
}

async function snap(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

async function startServer(dataDir, env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), WARDROBE_HOST: "127.0.0.1", WARDROBE_TOKEN: "", WARDROBE_DATA_DIR: dataDir, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", WARDROBE_AI_PROVIDER: "", ...env },
    stdio: "ignore",
  });
  await waitForServer(base, child);
  return { base, child };
}

describe("phone screens", () => {
  let dataDir;
  let server;
  let browser;
  let base;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "wardrobe-ui-"));
    await seed(dataDir);
    if (shots) await mkdir(shots, { recursive: true });
    ({ base, child: server } = await startServer(dataDir));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    server?.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  for (const colorScheme of ["light", "dark"]) {
    test(`closet, item, settings and outfits work (${colorScheme})`, async () => {
      const context = await browser.newContext({ ...devices["iPhone 13"], colorScheme });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

      await page.goto(base);
      await page.getByText("White oxford shirt").waitFor();
      assert.equal(await page.locator('[aria-label^="View "]').count(), PIECES.length);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
      await snap(page, `${colorScheme}-1-closet`);

      await page.locator('[aria-label="View White oxford shirt"]').click();
      await page.getByRole("dialog", { name: "Selected wardrobe item" }).waitFor();
      await snap(page, `${colorScheme}-2-item`);
      await page.getByRole("button", { name: "Close viewer" }).click();

      await page.getByRole("button", { name: "Settings and connection" }).click();
      await page.getByRole("dialog").getByText("Connected").waitFor();
      await snap(page, `${colorScheme}-3-settings`);
      await page.getByRole("button", { name: "Close settings" }).click();

      await page.getByRole("tab", { name: /Outfits/ }).click();
      await page.getByText(/No outfits yet/).waitFor();
      await snap(page, `${colorScheme}-4-outfits`);

      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  test("asks before any photo goes to the AI", async () => {
    const withKey = await startServer(dataDir, { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" });
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    const generated = [];
    page.on("request", (request) => { if (request.url().includes("/outfits/generate")) generated.push(request.url()); });
    try {
      await page.goto(withKey.base);
      await page.getByRole("tab", { name: /Outfits/ }).click();
      await page.getByRole("button", { name: "Style new outfits" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Send your photos to Claude?" });
      await dialog.waitFor();
      await snap(page, "light-6-ai-consent");
      await dialog.getByRole("button", { name: "Not now" }).click();
      await dialog.waitFor({ state: "detached" });
      assert.deepEqual(generated, []);
    } finally {
      await context.close();
      withKey.child.kill();
    }
  });

  test("images load with a token, and the link never holds it", async () => {
    const guarded = await startServer(dataDir, { WARDROBE_TOKEN: "s3cret-token" });
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    const imageUrls = [];
    page.on("request", (request) => { if (request.resourceType() === "image") imageUrls.push(request.url()); });
    await page.addInitScript((server) => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
      localStorage.setItem("wardrobe-server-url", server);
      localStorage.setItem("wardrobe-token", "s3cret-token");
    }, guarded.base);
    try {
      await page.goto(guarded.base);
      await page.getByText("White oxford shirt").waitFor();
      await page.waitForFunction(() => [...document.images].filter((image) => image.src.includes("/api/import/library/")).every((image) => image.complete && image.naturalWidth > 0));
      assert.ok(imageUrls.some((url) => url.includes("/api/import/library/")));
      assert.ok(imageUrls.every((url) => !url.includes("s3cret-token")));
    } finally {
      await context.close();
      guarded.child.kill();
    }
  });

  test("the phone app asks for a server first", async () => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; });
    await page.goto(base);
    await page.getByLabel("Server address").waitFor();
    await snap(page, "light-5-connect");
    await context.close();
  });
});
