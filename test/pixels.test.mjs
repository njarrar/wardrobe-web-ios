import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { frameTransparentGarment as nodeFrame } from "../scripts/import-job-api.mjs";
import { cropDetectedItem, decodePng, encodePng, frameTransparentGarment } from "../shared/pixels.mjs";

async function syntheticGarment() {
  // A red shirt shape on a transparent background, like background removal returns.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <path d="M362 200 L662 200 L820 330 L740 430 L680 390 L680 820 L344 820 L344 390 L284 430 L204 330 Z" fill="#b3261e"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("PNG round trip keeps pixels", async () => {
  const bytes = await syntheticGarment();
  const image = decodePng(bytes);
  assert.equal(image.width, 1024);
  const again = decodePng(encodePng(image));
  assert.deepEqual(Buffer.from(again.data), Buffer.from(image.data));
});

test("decodes RGB and grayscale PNGs to RGBA", async () => {
  const rgb = decodePng(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#102030" } }).png().toBuffer());
  assert.deepEqual([...rgb.data.subarray(0, 4)], [16, 32, 48, 255]);
  const gray = decodePng(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#808080" } }).grayscale().png().toBuffer());
  assert.deepEqual([...gray.data.subarray(0, 4)], [128, 128, 128, 255]);
});

test("worker framing matches the Node version", async () => {
  const bytes = await syntheticGarment();
  const worker = frameTransparentGarment(decodePng(bytes));
  assert.equal(worker.width, 1024);
  const { data: nodeData } = await sharp(await nodeFrame(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let both = 0;
  let either = 0;
  for (let index = 3; index < nodeData.length; index += 4) {
    const a = worker.data[index] > 128;
    const b = nodeData[index] > 128;
    if (a && b) both += 1;
    if (a || b) either += 1;
  }
  assert.ok(both / either > 0.97, `overlap ${(both / either).toFixed(3)}`);
});

test("crops a detected item with padding", () => {
  const image = { width: 1000, height: 500, data: new Uint8Array(1000 * 500 * 4) };
  const cropped = cropDetectedItem(image, { x: 100, y: 100, width: 200, height: 400 });
  // box is 200x200 px; padding is max(12, 8% of 200) = 16
  assert.equal(cropped.width, 232);
  assert.equal(cropped.height, 232);
});
