// Store screenshots from the real app. Run `npm run build` first.
//   node scripts/store-screenshots.mjs
// draws a sample closet and saves iPhone (1320 x 2868), 13-inch iPad
// (2064 x 2752) and Android (1080 x 1920) screenshots to store/screenshots/. To use your own closet:
//   WARDROBE_URL=https://your-server WARDROBE_TOKEN=... node scripts/store-screenshots.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { writeSampleCloset } from "./sample-closet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "store/screenshots");

const DEVICES = {
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  android: { viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startSampleServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wardrobe-store-"));
  await writeSampleCloset(dataDir);
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), WARDROBE_HOST: "127.0.0.1", WARDROBE_TOKEN: "", WARDROBE_DATA_DIR: dataDir, ANTHROPIC_API_KEY: "sample", WARDROBE_AI_PROVIDER: "claude" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { base, stop: async () => { child.kill(); await rm(dataDir, { recursive: true, force: true }); } };
}

const own = process.env.WARDROBE_URL?.replace(/\/+$/, "");
const server = own ? { base: own, stop: async () => {} } : await startSampleServer();
const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });

try {
  for (const [name, device] of Object.entries(DEVICES)) {
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({ ...device, colorScheme });
      if (process.env.WARDROBE_TOKEN) {
        await context.addInitScript((token) => localStorage.setItem("wardrobe-token", token), process.env.WARDROBE_TOKEN);
      }
      const page = await context.newPage();
      const shot = async (label) => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outDir, `${name}-${colorScheme}-${label}.png`) });
      };
      await page.goto(server.base);
      await page.locator('[aria-label^="View "]').first().waitFor();
      await page.waitForLoadState("networkidle");
      await shot("1-closet");
      if (colorScheme === "dark") { await context.close(); continue; }

      await page.locator('[aria-label^="View "]').first().click();
      await page.getByRole("dialog").waitFor();
      await shot("2-piece");
      await page.getByRole("button", { name: "Close viewer" }).click();

      await page.getByRole("tab", { name: /Outfits/ }).click();
      await page.locator(".outfit-card").first().waitFor();
      await page.locator(".outfit-grid").scrollIntoViewIfNeeded();
      await shot("3-outfits");

      await page.locator(".outfit-card").first().click();
      await page.getByRole("dialog").waitFor();
      await shot("4-outfit");
      await context.close();
    }
  }
  console.log(`Screenshots saved to ${path.relative(root, outDir)}/`);
} finally {
  await browser.close();
  await server.stop();
}
