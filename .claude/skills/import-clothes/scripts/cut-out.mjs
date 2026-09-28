#!/usr/bin/env node
// Crops one garment out of a photo and removes its background with the same
// code the Wardrobe app uses. Run from the repository root:
//
//   node .claude/skills/import-clothes/scripts/cut-out.mjs \
//     --photo ~/Pictures/look.jpg --box 120,80,600,450 --out "$WORK/items/navy-tee.png"
//
// --box is x,y,width,height on a 1000 by 1000 grid laid over the photo.
// --keep-background skips background removal and frames the crop as is.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const repo = process.cwd();
const { cropDetectedItem, removeBackground, frameTransparentGarment, DEFAULT_CUTOUT_MODEL } = await import(path.join(repo, "scripts/import-job-api.mjs"));

const options = {};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index];
  if (argument === "--keep-background") { options.keepBackground = true; continue; }
  if (!["--photo", "--box", "--out", "--model"].includes(argument)) throw new Error(`Unknown option: ${argument}`);
  options[argument.slice(2)] = argv[index + 1];
  index += 1;
}
if (!options.photo || !options.box || !options.out) {
  console.error("Usage: cut-out.mjs --photo <file> --box x,y,width,height --out <file.png> [--keep-background] [--model <id>]");
  process.exit(1);
}
const [x, y, width, height] = options.box.split(",").map(Number);
if (![x, y, width, height].every(Number.isFinite)) throw new Error("--box needs four numbers: x,y,width,height");

const upright = await sharp(await readFile(options.photo)).rotate().toColorspace("srgb").png().toBuffer();
const crop = await cropDetectedItem(upright, { x, y, width, height });
const cut = options.keepBackground ? crop : await removeBackground(crop, options.model || process.env.WARDROBE_CUTOUT_MODEL || DEFAULT_CUTOUT_MODEL);
await writeFile(options.out, await frameTransparentGarment(cut));
console.log(JSON.stringify({ out: path.resolve(options.out), keptBackground: Boolean(options.keepBackground) }));
