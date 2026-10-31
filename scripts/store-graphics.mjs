// Google Play icon (512 x 512) and feature graphic (1024 x 500), drawn from
// the same shirt mark as the app icon:
//   node scripts/store-graphics.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "store/graphics");
const PAPER = "#f4f0e8";
const INK = "#191919";
const ACCENT = "#c2562b";

const mark = (x, y, scale) => `
  <g transform="translate(${x} ${y}) scale(${scale}) translate(-256 -256)">
    <path d="M178 142l-74 58 42 65 38-21v132h144V244l38 21 42-65-74-58-47 30h-62l-47-30Z" fill="none" stroke="${INK}" stroke-linejoin="round" stroke-width="20"/>
    <path d="M225 172c5 26 57 26 62 0" fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="20"/>
  </g>`;

await mkdir(out, { recursive: true });

// Play rounds the corners itself, so the icon is a full square.
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${PAPER}"/>${mark(256, 256, 1)}</svg>`))
  .png().toFile(path.join(out, "play-icon-512.png"));

await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  <rect width="1024" height="500" fill="${PAPER}"/>
  <circle cx="860" cy="250" r="300" fill="${ACCENT}" opacity="0.08"/>
  <rect x="96" y="150" width="200" height="200" rx="46" fill="#ffffff"/>
  ${mark(196, 250, 0.39)}
  <text x="350" y="236" font-family="Helvetica, Arial, sans-serif" font-size="68" font-weight="700" fill="${INK}" letter-spacing="-2">Wardrobe</text>
  <text x="352" y="296" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#5d5952">Your clothes, cut out and styled by AI.</text>
  <text x="352" y="340" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#5d5952">Kept on your own server.</text>
</svg>`)).png().toFile(path.join(out, "play-feature-1024x500.png"));

console.log(`Store graphics saved to ${path.relative(root, out)}/`);
