// Copies the version from package.json into the phone app projects, so the
// web app, the iOS app and the Android app always show the same number.
// BUILD_NUMBER (set by the release workflow) becomes the store build number.
//   node scripts/sync-version.mjs          write the version
//   node scripts/sync-version.mjs --check  fail if a project is out of date
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const build = process.env.BUILD_NUMBER?.trim();
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Store versions must look like 1.2.3, not ${version}`);
if (build && !/^\d+$/.test(build)) throw new Error(`BUILD_NUMBER must be a whole number, not ${build}`);

const projects = [
  {
    file: "ios/App/App.xcodeproj/project.pbxproj",
    rules: [
      [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
      ...(build ? [[/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`]] : []),
    ],
  },
  {
    file: "android/app/build.gradle",
    rules: [
      [/versionName "[^"]*"/g, `versionName "${version}"`],
      ...(build ? [[/versionCode \d+/g, `versionCode ${build}`]] : []),
    ],
  },
];

let stale = [];
for (const { file, rules } of projects) {
  const full = path.join(root, file);
  const before = await readFile(full, "utf8").catch(() => null);
  if (before === null) continue;
  const after = rules.reduce((text, [pattern, value]) => text.replace(pattern, value), before);
  if (after === before) continue;
  if (check) stale.push(file);
  else await writeFile(full, after);
}

if (stale.length) {
  console.error(`Version ${version} is missing from ${stale.join(", ")}. Run npm run version:sync.`);
  process.exit(1);
}
console.log(check ? `Apps match version ${version}` : `Apps set to version ${version}${build ? ` (build ${build})` : ""}`);
