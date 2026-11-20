import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

async function walk(dir, ext) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, ext)));
    else if (entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

// Words shown on screen must go through t(), or they stay English in Arabic.
// Catches multi-word AND single-word capitalized text between tags, plus
// plain placeholders, aria-labels, titles, and alt strings across src/.
test("screens have no text outside t()", async () => {
  const found = [];
  for (const file of await walk(SRC_DIR, ".jsx")) {
    const rel = path.relative(SRC_DIR, file);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (/^\s*\/\//.test(line)) return;
      for (const match of line.matchAll(/>\s*([A-Z][a-z]+(?: [A-Za-z’',.#-]+)*)\s*<\/(?:button|h[1-6]|label|legend|option|p|span|strong|small|summary|th|td|dt|dd|a)>/g)) {
        found.push(`${rel}:${index + 1}: ${match[1]}`);
      }
      for (const match of line.matchAll(/>\s*([A-Z][a-z]+(?: [A-Za-z’',.#-]+)+)\s*[<{]/g)) {
        found.push(`${rel}:${index + 1}: ${match[1]}`);
      }
      for (const match of line.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) {
        if (!/^[\d.:]+$/.test(match[1])) found.push(`${rel}:${index + 1}: ${match[1]}`);
      }
      for (const match of line.matchAll(/(?:placeholder|aria-label)=\{`[^`]*[A-Za-z]{3,} [^`]*`\}/g)) {
        if (!match[0].includes("t(")) found.push(`${rel}:${index + 1}: ${match[0]}`);
      }
    });
  }
  assert.deepEqual(found, []);
});
