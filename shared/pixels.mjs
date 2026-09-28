// Pure-JS image steps for the Cloudflare Worker, which cannot run sharp.
// Images are { width, height, data } with 8-bit RGBA pixels in `data`.
import { decode, encode } from "fast-png";
import { normalizeBoundingBox } from "./core.mjs";

export function decodePng(bytes) {
  const png = decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const { width, height } = png;
  const pixels = width * height;
  const out = new Uint8Array(pixels * 4);
  const source = png.data;
  const scale = png.depth === 16 ? 257 : png.depth < 8 ? 255 / ((2 ** png.depth) - 1) : 1;
  const value = (index) => Math.round(source[index] / scale);
  if (png.palette) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const entry = png.palette[source[pixel]] || [0, 0, 0, 255];
      out.set([entry[0], entry[1], entry[2], entry[3] ?? 255], pixel * 4);
    }
    return { width, height, data: out };
  }
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
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = ((top + y) * image.width + left) * 4;
    out.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, data: out };
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

// Bilinear resize on premultiplied alpha so transparent edges do not halo.
export function resize(image, width, height) {
  const out = new Uint8Array(width * height * 4);
  const { data } = image;
  const xRatio = image.width / width;
  const yRatio = image.height / height;
  const sample = (x, y, channel) => {
    const at = (y * image.width + x) * 4;
    return channel === 3 ? data[at + 3] : data[at + channel] * (data[at + 3] / 255);
  };
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sx - x0;
      const to = (y * width + x) * 4;
      const mix = (channel) => (
        (sample(x0, y0, channel) * (1 - fx) + sample(x1, y0, channel) * fx) * (1 - fy)
        + (sample(x0, y1, channel) * (1 - fx) + sample(x1, y1, channel) * fx) * fy
      );
      const alpha = mix(3);
      out[to + 3] = Math.round(alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        out[to + channel] = alpha > 0 ? Math.min(255, Math.round(mix(channel) * 255 / alpha)) : 0;
      }
    }
  }
  return { width, height, data: out };
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
