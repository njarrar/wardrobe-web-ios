// A drawn sample closet for store screenshots and demos. Writes the pieces
// and a few outfits into a Wardrobe data folder:
//   node scripts/sample-closet.mjs <data folder>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { addDays, dayString } from "../shared/style.mjs";
import { SHAPES } from "../shared/shapes.mjs";


const PIECES = [
  ["oxford", "White oxford shirt", "upperbody", "shirt", "#f3f1ec", ["cotton", "smart"]],
  ["navy-tee", "Navy crew tee", "upperbody", "tee", "#2f4a7a", ["cotton", "casual"]],
  ["stripe-tee", "Breton stripe tee", "upperbody", "stripedTee", "#1f3566", ["casual"]],
  ["grey-knit", "Grey merino sweater", "upperbody", "sweater", "#9a9893", ["wool", "warm"]],
  ["olive-jacket", "Olive field jacket", "wholebody_up", "jacket", "#5f6b3f", ["cotton", "pockets"]],
  ["trench", "Beige trench coat", "wholebody_up", "coat", "#cdb88f", ["rain", "smart"]],
  ["jeans", "Indigo jeans", "lowerbody", "jeans", "#2c3e66", ["denim"]],
  ["chinos", "Stone chinos", "lowerbody", "trousers", "#c9b996", ["cotton", "smart casual"]],
  ["black-trousers", "Black trousers", "lowerbody", "trousers", "#222222", ["smart"]],
  ["sneakers", "White leather sneakers", "shoes", "sneakers", "#f6f4ef", ["leather"]],
  ["loafers", "Brown loafers", "shoes", "loafers", "#6e4428", ["leather", "smart"]],
  ["boots", "Black Chelsea boots", "shoes", "boots", "#26221f", ["leather", "rain"]],
  ["tote", "Tan canvas tote", "accessories_up", "tote", "#b98a5a", ["canvas"]],
  ["scarf", "Rust wool scarf", "accessories_up", "scarf", "#a9502f", ["wool", "warm"]],
];

const OUTFITS = [
  ["easy-saturday", "Easy Saturday", ["weekend", "coffee"], "Relaxed layers for a slow morning in town.", ["stripe-tee", "olive-jacket", "jeans", "sneakers"]],
  ["office-no-tie", "Office, no tie", ["work"], "Sharp but easy: the oxford and chinos with loafers.", ["oxford", "chinos", "loafers", "tote"]],
  ["rainy-day", "Rainy day", ["rain", "work"], "The trench and boots keep you dry, the knit keeps you warm.", ["grey-knit", "trench", "black-trousers", "boots"]],
  ["dinner-out", "Dinner out", ["dinner"], "Dark and simple, with a little color at the neck.", ["navy-tee", "black-trousers", "loafers", "scarf"]],
  ["navy-and-rust", "Navy and rust", ["weekend"], "Navy leads and the rust scarf sits across the wheel.", ["navy-tee", "chinos", "loafers", "scarf"]],
  ["quiet-greys", "Quiet greys", ["work"], "Grey and black with white shoes to lift it.", ["grey-knit", "black-trousers", "sneakers"]],
  ["city-layers", "City layers", ["work", "smart"], "The trench over a crisp oxford, calm and tonal.", ["oxford", "trench", "chinos", "loafers"]],
  ["denim-day", "Denim day", ["weekend", "casual"], "Indigo on navy, close on the wheel.", ["navy-tee", "jeans", "boots"]],
];

// Kind, seasons, warmth and dress level, as the AI would sort them.
const SORT = {
  oxford: ["shirt", ["spring", "summer", "fall"], 2, "smart"], "navy-tee": ["tee", ["spring", "summer"], 1, "casual"],
  "stripe-tee": ["tee", ["spring", "summer"], 2, "casual"], "grey-knit": ["sweater", ["fall", "winter"], 4, "smart"],
  "olive-jacket": ["jacket", ["spring", "fall"], 3, "casual"], trench: ["coat", ["spring", "fall"], 4, "smart"],
  jeans: ["jeans", ["spring", "fall", "winter"], 3, "casual"], chinos: ["chinos", ["spring", "summer", "fall"], 2, "smart"],
  "black-trousers": ["trousers", ["fall", "winter", "spring"], 3, "formal"], sneakers: ["sneakers", ["spring", "summer", "fall"], 2, "casual"],
  loafers: ["loafers", ["spring", "summer", "fall"], 2, "smart"], boots: ["boots", ["fall", "winter"], 4, "smart"],
  tote: ["bag", ["spring", "summer", "fall", "winter"], 1, "casual"], scarf: ["scarf", ["fall", "winter"], 4, "casual"],
};

// Days ago each sample piece was worn, and what it cost, so the wear log,
// the Not worn in a while row and cost per wear have something to show.
const WEAR = {
  oxford: [[3, 10, 17, 24, 38], 60], "navy-tee": [[1, 6, 13, 20], 18], "stripe-tee": [[5, 26], 35],
  "grey-knit": [[2, 9, 30], 95], "olive-jacket": [[5, 40], 140], trench: [[640], 210], jeans: [[1, 5, 26], 80],
  chinos: [[3, 10, 17], 55], "black-trousers": [[2, 9, 30, 44], 70], sneakers: [[1, 2, 5, 26], 110],
  loafers: [[3, 10, 17], 130], boots: [[250], 160], tote: [[3, 17], 40], scarf: [[], 30],
};

export async function writeSampleCloset(dataDir) {
  const imported = path.join(dataDir, "imported");
  await mkdir(imported, { recursive: true });
  const records = [];
  const today = dayString();
  for (const [index, [id, name, part, shape, color, tags]] of PIECES.entries()) {
    const file = `sample-${id}.png`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">${SHAPES[shape](color)}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(imported, file));
    records.push({
      id: `import-sample-${id}`, name, part, color, secondaryColor: null, palette: [color], tags,
      image: `/api/import/library/${file}`, thumbnail: `/api/import/library/${file}`,
      addedAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      wornDates: (WEAR[id]?.[0] || []).map((ago) => addDays(today, -ago)).sort(),
      price: WEAR[id]?.[1] ?? null,
      kind: SORT[id][0], seasons: SORT[id][1], warmth: SORT[id][2], formality: SORT[id][3],
    });
  }
  await writeFile(path.join(dataDir, "library.json"), JSON.stringify(records, null, 2));
  const outfits = OUTFITS.map(([id, name, occasion, reason, ids], index) => ({
    id, name, occasion, reason, garmentIds: ids.map((piece) => `import-sample-${piece}`), image: null,
    createdAt: new Date(Date.UTC(2026, 9, 20 - index)).toISOString(),
  }));
  await writeFile(path.join(dataDir, "outfits.json"), JSON.stringify({ version: 1, outfits }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) { console.error("Usage: node scripts/sample-closet.mjs <data folder>"); process.exit(1); }
  await writeSampleCloset(path.resolve(target));
  console.log(`Sample closet written to ${target}`);
}
