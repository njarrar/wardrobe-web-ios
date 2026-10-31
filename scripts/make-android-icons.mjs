// Draws the Android launcher icons and splash screens from the same shirt
// mark as public/icon.svg. Run it after changing the icon:
//   node scripts/make-android-icons.mjs
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android/app/src/main/res");
const PAPER = "#f4f0e8";
const SPLASH = "#f5f3ee";
const INK = "#191919";

const mark = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M178 142l-74 58 42 65 38-21v132h144V244l38 21 42-65-74-58-47 30h-62l-47-30Z" fill="none" stroke="${INK}" stroke-linejoin="round" stroke-width="20"/>
    <path d="M225 172c5 26 57 26 62 0" fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="20"/>
  </g>`;
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`);

const square = svg(`<rect width="512" height="512" rx="112" fill="${PAPER}"/>${mark(1)}`);
const round = svg(`<circle cx="256" cy="256" r="256" fill="${PAPER}"/>${mark(0.9)}`);
// Adaptive icons crop to the middle 66 of 108 dp, so the mark sits smaller.
const foreground = svg(mark(0.66));

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [name, factor] of Object.entries(DENSITIES)) {
  const dir = path.join(res, `mipmap-${name}`);
  await mkdir(dir, { recursive: true });
  const launcher = Math.round(48 * factor);
  const adaptive = Math.round(108 * factor);
  await sharp(square, { density: 300 }).resize(launcher, launcher).png().toFile(path.join(dir, "ic_launcher.png"));
  await sharp(round, { density: 300 }).resize(launcher, launcher).png().toFile(path.join(dir, "ic_launcher_round.png"));
  await sharp(foreground, { density: 300 }).resize(adaptive, adaptive).png().toFile(path.join(dir, "ic_launcher_foreground.png"));
}

// Splash screens: the same plain paper color as the iOS launch screen.
for (const folder of await readdir(res)) {
  if (!folder.startsWith("drawable")) continue;
  const file = path.join(res, folder, "splash.png");
  const meta = await sharp(file).metadata().catch(() => null);
  if (!meta) continue;
  await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: SPLASH } }).png().toFile(file);
}

console.log("Android icons and splash screens updated");
