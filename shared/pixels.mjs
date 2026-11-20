// Pure-JS image steps for the Cloudflare Worker, which cannot run sharp.
// Images are { width, height, data } with 8-bit RGBA pixels in `data`.
import { decode, encode } from "fast-png";
import { normalizeBoundingBox } from "./core.mjs";

function unpackSubByte(source, width, height, depth) {
  const out = new Uint8Array(width * height);
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  const rowBytes = Math.ceil((width * depth) / 8);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    const dstRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const byte = source[rowStart + Math.floor(x / perByte)];
      const shift = 8 - depth * ((x % perByte) + 1);
      out[dstRow + x] = (byte >> shift) & mask;
    }
  }
  return out;
}

export function decodePng(bytes) {
  const png = decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const { width, height, depth } = png;
  const pixels = width * height;
  const out = new Uint8Array(pixels * 4);
  const source = depth < 8 ? unpackSubByte(png.data, width, height, depth) : png.data;
  if (png.palette) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const entry = png.palette[source[pixel]] || [0, 0, 0, 255];
      const to = pixel * 4;
      out[to] = entry[0];
      out[to + 1] = entry[1];
      out[to + 2] = entry[2];
      out[to + 3] = entry[3] ?? 255;
    }
    return { width, height, data: out };
  }
  const factor = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const value = depth === 16
    ? (index) => Math.round(source[index] / 257)
    : depth < 8
      ? (index) => Math.round(source[index] * factor)
      : (index) => source[index];
  const channels = png.channels;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = pixel * channels;
    const to = pixel * 4;
    if (channels >= 3) {
      out[to] = value(at);
      out[to + 1] = value(at + 1);
      out[to + 2] = value(at + 2);
      out[to + 3] = channels === 4 ? value(at + 3) : 255;
    } else {
      const gray = value(at);
      out[to] = gray;
      out[to + 1] = gray;
      out[to + 2] = gray;
      out[to + 3] = channels === 2 ? value(at + 1) : 255;
    }
  }
  return { width, height, data: out };
}

export function encodePng(image) {
  return encode({ width: image.width, height: image.height, data: image.data, channels: 4, depth: 8 });
}

export function crop(image, left, top, width, height) {
  const x0 = Math.max(0, Math.min(image.width, Math.floor(left)));
  const y0 = Math.max(0, Math.min(image.height, Math.floor(top)));
  const x1 = Math.max(x0, Math.min(image.width, Math.floor(left + width)));
  const y1 = Math.max(y0, Math.min(image.height, Math.floor(top + height)));
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const start = ((y0 + y) * image.width + x0) * 4;
    out.set(image.data.subarray(start, start + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

// Same padding rules as cropDetectedItem in scripts/import-job-api.mjs.
export function cropDetectedItem(image, boundingBox) {
  const { width, height } = image;
  const box = normalizeBoundingBox(boundingBox);
  const rawLeft = (box.x / 1000) * width;
  const rawTop = (box.y / 1000) * height;
  const rawWidth = (box.width / 1000) * width;
  const rawHeight = (box.height / 1000) * height;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  return crop(image, left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

// Premultiplied-alpha resize so transparent edges never halo. Uses area/box
// averaging when downscaling > 2x to prevent moiré aliasing, and inlined
// bilinear interpolation otherwise.
export function resize(image, width, height) {
  const dstW = Math.max(1, Math.round(width));
  const dstH = Math.max(1, Math.round(height));
  const srcW = image.width;
  const srcH = image.height;
  const out = new Uint8Array(dstW * dstH * 4);
  const { data } = image;
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  if (xRatio > 2 || yRatio > 2) {
    for (let y = 0; y < dstH; y += 1) {
      const sy0 = Math.floor(y * yRatio);
      const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.ceil((y + 1) * yRatio)));
      for (let x = 0; x < dstW; x += 1) {
        const sx0 = Math.floor(x * xRatio);
        const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.ceil((x + 1) * xRatio)));
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let aSum = 0;
        let count = 0;
        for (let sy = sy0; sy < sy1; sy += 1) {
          const row = sy * srcW;
          for (let sx = sx0; sx < sx1; sx += 1) {
            const at = (row + sx) * 4;
            const a = data[at + 3];
            const wf = a / 255;
            rSum += data[at] * wf;
            gSum += data[at + 1] * wf;
            bSum += data[at + 2] * wf;
            aSum += a;
            count += 1;
          }
        }
        const to = (y * dstW + x) * 4;
        const alpha = aSum / count;
        out[to + 3] = Math.round(alpha);
        if (alpha > 0) {
          const inv = 255 / aSum;
          out[to] = Math.min(255, Math.round(rSum * inv));
          out[to + 1] = Math.min(255, Math.round(gSum * inv));
          out[to + 2] = Math.min(255, Math.round(bSum * inv));
        }
      }
    }
    return { width: dstW, height: dstH, data: out };
  }

  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = sy - y0;
    const invFy = 1 - fy;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = sx - x0;
      const invFx = 1 - fx;

      const w00 = invFx * invFy;
      const w10 = fx * invFy;
      const w01 = invFx * fy;
      const w11 = fx * fy;

      const i00 = (row0 + x0) * 4;
      const i10 = (row0 + x1) * 4;
      const i01 = (row1 + x0) * 4;
      const i11 = (row1 + x1) * 4;

      const a00 = data[i00 + 3];
      const a10 = data[i10 + 3];
      const a01 = data[i01 + 3];
      const a11 = data[i11 + 3];
      const alpha = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;

      const to = (y * dstW + x) * 4;
      out[to + 3] = Math.round(alpha);
      if (alpha > 0) {
        const p00 = (a00 / 255) * w00;
        const p10 = (a10 / 255) * w10;
        const p01 = (a01 / 255) * w01;
        const p11 = (a11 / 255) * w11;
        const inv = 255 / alpha;
        out[to] = Math.min(255, Math.round((data[i00] * p00 + data[i10] * p10 + data[i01] * p01 + data[i11] * p11) * inv));
        out[to + 1] = Math.min(255, Math.round((data[i00 + 1] * p00 + data[i10 + 1] * p10 + data[i01 + 1] * p01 + data[i11 + 1] * p11) * inv));
        out[to + 2] = Math.min(255, Math.round((data[i00 + 2] * p00 + data[i10 + 2] * p10 + data[i01 + 2] * p01 + data[i11 + 2] * p11) * inv));
      }
    }
  }
  return { width: dstW, height: dstH, data: out };
}

export function frameTransparentGarment(image, canvasSize = 1024, occupancy = 0.88) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0, pixel = 0; index < image.data.length; index += 4, pixel += 1) {
    if (image.data[index + 3] <= 8) continue;
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) throw new Error("Background removal did not leave a visible garment");
  const trimmed = crop(image, minX, minY, maxX - minX + 1, maxY - minY + 1);
  const target = Math.max(1, Math.round(canvasSize * Math.max(0.5, Math.min(0.96, occupancy))));
  const scale = Math.min(target / trimmed.width, target / trimmed.height);
  const resized = resize(trimmed, Math.max(1, Math.round(trimmed.width * scale)), Math.max(1, Math.round(trimmed.height * scale)));
  const out = new Uint8Array(canvasSize * canvasSize * 4);
  const left = Math.floor((canvasSize - resized.width) / 2);
  const top = Math.floor((canvasSize - resized.height) / 2);
  for (let y = 0; y < resized.height; y += 1) {
    out.set(resized.data.subarray(y * resized.width * 4, (y + 1) * resized.width * 4), ((top + y) * canvasSize + left) * 4);
  }
  return { width: canvasSize, height: canvasSize, data: out };
}
