// App Store images: each raw screenshot goes inside a device frame with a
// headline above it. Run `npm run store:screenshots` first.
//   node scripts/store-frames.mjs
// saves iPhone (1320 x 2868) and 13-inch iPad (2064 x 2752) images to
// store/framed/. scripts/store-listing.mjs sends these to the App Store.
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = path.join(root, "store/screenshots");
const outDir = path.join(root, "store/framed");
const fontFile = path.join(root, "node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2");

// Order here is the order in the store. `dark` uses the dark mode screenshot.
const SLIDES = [
  { shot: "1-home", theme: "light", kicker: "Today", title: "Know what to wear\nbefore coffee", sub: "An outfit from your own closet, ready each morning." },
  { shot: "4-outfits", theme: "warm", kicker: "Outfits", title: "New outfits from\nclothes you own", sub: "Ideas for work, dinner, a rainy day or a lazy Saturday." },
  { shot: "6-plan", theme: "dark", kicker: "Plan", title: "Plan the whole\nmonth in one tap", sub: "No repeats, and the pieces you forgot get worn again." },
  { shot: "2-closet", theme: "light", kicker: "Closet", title: "Your whole closet,\ncut out and sorted", sub: "Snap a photo. The AI cuts out each piece and tags it." },
  { shot: "3-piece", theme: "warm", kicker: "Pieces", title: "See what each\npiece goes with", sub: "How often you wear it, and what to pair it with." },
  { shot: "1-home", dark: true, theme: "dark", kicker: "Dark mode", title: "Easy on the eyes\nat night", sub: "Light and dark looks, in English and Arabic." },
];

const THEMES = {
  light: { bg: "linear-gradient(170deg, #f7f4ee 0%, #ece5d8 100%)", ink: "#17171a", soft: "#5d5a55", accent: "#c2562b" },
  warm: { bg: "linear-gradient(170deg, #d9683a 0%, #b4481f 100%)", ink: "#ffffff", soft: "rgba(255,255,255,0.82)", accent: "#ffe3d3" },
  dark: { bg: "linear-gradient(170deg, #1d1c1f 0%, #0b0b0c 100%)", ink: "#f5f3ee", soft: "rgba(245,243,238,0.66)", accent: "#ef8354" },
};

// Canvas sizes in CSS pixels, rendered at `scale`. Shot sizes match
// scripts/store-screenshots.mjs.
const DEVICES = {
  iphone: {
    canvas: [440, 956], scale: 3, shot: [440, 956],
    screenW: 300, bar: 38, bezel: 11, radius: 56, top: 222,
    text: { top: 62, kicker: 13, title: 35, sub: 15.5, gap: 12 },
    island: true, barPad: "4px 26px 0 30px", barFont: 13,
  },
  ipad: {
    canvas: [1032, 1376], scale: 2, shot: [1032, 1376],
    screenW: 800, bar: 30, bezel: 20, radius: 40, top: 226, oneLine: true,
    text: { top: 74, kicker: 17, title: 52, sub: 21, gap: 14 },
    island: false, barPad: "2px 26px 0 28px", barFont: 13,
  },
};

const statusIcons = (ink) => `<svg width="58" height="12" viewBox="0 0 58 12" fill="${ink}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.5" y="6" width="3" height="6" rx="1"/><rect x="9" y="3.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="1" width="3" height="11" rx="1"/><path d="M28 3.2a9 9 0 0 1 6.4 2.6l1.1-1.1A10.6 10.6 0 0 0 28 1.6a10.6 10.6 0 0 0-7.5 3.1l1.1 1.1A9 9 0 0 1 28 3.2Zm0 3.2a5.8 5.8 0 0 1 4.1 1.7l1.1-1.1a7.4 7.4 0 0 0-10.4 0l1.1 1.1A5.8 5.8 0 0 1 28 6.4Zm0 3.2a2.6 2.6 0 0 1 1.8.8L28 12.2l-1.8-1.8a2.6 2.6 0 0 1 1.8-.8Z"/><rect x="38.5" y="1" width="17" height="10" rx="3" fill="none" stroke="${ink}" stroke-opacity=".45"/><rect x="40.5" y="3" width="12" height="6" rx="1.5"/><rect x="56.3" y="4" width="1.5" height="4" rx=".7" fill-opacity=".45"/></svg>`;

function html(device, slide, imageData, fontData) {
  const d = DEVICES[device];
  const t = THEMES[slide.theme];
  const [W, H] = d.canvas;
  const screenH = Math.round(d.screenW * d.shot[1] / d.shot[0]) + d.bar;
  const ink = slide.dark ? "#f5f3ee" : "#111";
  const inner = d.radius - d.bezel;
  const buttons = device === "iphone"
    ? `<div class="btn" style="left:-3px;top:150px;height:28px"></div><div class="btn" style="left:-3px;top:200px;height:50px"></div><div class="btn" style="left:-3px;top:262px;height:50px"></div><div class="btn" style="right:-3px;top:220px;height:80px"></div>`
    : `<div class="btn top" style="right:70px;width:46px"></div><div class="btn top" style="right:126px;width:46px"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Instrument Sans"; src: url(data:font/woff2;base64,${fontData}) format("woff2"); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${t.bg}; font-family: "Instrument Sans", sans-serif; color: ${t.ink}; }
.text { position: absolute; top: ${d.text.top}px; left: 0; right: 0; text-align: center; padding: 0 28px; }
.kicker { display: inline-block; font-size: ${d.text.kicker}px; font-weight: 650; letter-spacing: 0.14em; text-transform: uppercase; color: ${t.accent}; margin-bottom: ${d.text.gap}px; }
h1 { font-size: ${d.text.title}px; line-height: 1.08; font-weight: 680; letter-spacing: -0.03em; white-space: pre-line; }
p { margin-top: ${d.text.gap}px; font-size: ${d.text.sub}px; line-height: 1.35; color: ${t.soft}; font-weight: 480; }
.device { position: absolute; left: 50%; top: ${d.top}px; transform: translateX(-50%); width: ${d.screenW + d.bezel * 2}px; height: ${screenH + d.bezel * 2}px;
  padding: ${d.bezel}px; border-radius: ${d.radius}px; background: #0c0c0d;
  box-shadow: 0 0 0 1.5px #3a3a3d inset, 0 0 0 1px rgba(0,0,0,0.25), 0 30px 60px -18px rgba(0,0,0,0.45), 0 12px 24px -12px rgba(0,0,0,0.3); }
.screen { position: relative; width: 100%; height: 100%; border-radius: ${inner}px; overflow: hidden; background: #fff; }
.screen img { width: 100%; display: block; }
.bar { height: ${d.bar}px; display: flex; align-items: center; justify-content: space-between; padding: ${d.barPad}; color: ${ink}; font-size: ${d.barFont}px; font-weight: 640; }
.bar svg { display: block; }
.island { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 92px; height: 27px; border-radius: 20px; background: #000; }
.btn { position: absolute; width: 3px; background: #2a2a2c; border-radius: 2px; }
.btn.top { top: -3px; height: 3px; }
</style></head><body>
<div class="text"><span class="kicker">${slide.kicker}</span><h1>${d.oneLine ? slide.title.replace("\n", " ") : slide.title}</h1><p>${slide.sub}</p></div>
<div class="device">${buttons}
  <div class="screen"><div class="bar"><span>9:41</span>${statusIcons(ink)}</div><img src="data:image/png;base64,${imageData}">${d.island ? '<div class="island"></div>' : ""}</div>
</div>
</body></html>`;
}

const fontData = (await readFile(fontFile)).toString("base64");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [device, d] of Object.entries(DEVICES)) {
    const page = await browser.newPage({ viewport: { width: d.canvas[0], height: d.canvas[1] }, deviceScaleFactor: d.scale });
    for (const [index, slide] of SLIDES.entries()) {
      const shot = path.join(shotsDir, `${device}-${slide.dark ? "dark" : "light"}-${slide.shot}.png`);
      const imageData = await readFile(shot).catch(() => {
        throw new Error(`${path.relative(root, shot)} is missing; run npm run store:screenshots`);
      });
      await page.setContent(html(device, slide, imageData.toString("base64"), fontData));
      // Paint the status bar in the app's own top color.
      await page.evaluate(async () => {
        await document.fonts.ready;
        const img = document.querySelector(".screen img");
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = 4;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const [r, g, b] = ctx.getImageData(Math.floor(img.naturalWidth / 2), 1, 1, 1).data;
        document.querySelector(".screen").style.background = `rgb(${r},${g},${b})`;
      });
      await page.screenshot({ path: path.join(outDir, `${device}-${index + 1}-${slide.kicker.toLowerCase().replace(/\s+/g, "-")}.png`) });
    }
    await page.close();
  }
  console.log(`Framed images saved to ${path.relative(root, outDir)}/`);
} finally {
  await browser.close();
}
