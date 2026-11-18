import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

// Words shown on screen must go through t(), or they stay English in Arabic.
// This catches plain text between tags and plain placeholders and labels.
test("screens have no text outside t()", async () => {
  const found = [];
  for (const name of (await readdir("src")).filter((file) => file.endsWith(".jsx"))) {
    const lines = (await readFile(`src/${name}`, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/>\s*([A-Z][a-z]+(?: [A-Za-z’',.#-]+)+)\s*[<{]/g)) found.push(`${name}:${index + 1}: ${match[1]}`);
      for (const match of line.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) {
        if (!/^[\d.:]+$/.test(match[1])) found.push(`${name}:${index + 1}: ${match[1]}`);
      }
      for (const match of line.matchAll(/(?:placeholder|aria-label)=\{`[^`]*[A-Za-z]{3,} [^`]*`\}/g)) {
        if (!match[0].includes("t(")) found.push(`${name}:${index + 1}: ${match[0]}`);
      }
    });
  }
  assert.deepEqual(found, []);
});
