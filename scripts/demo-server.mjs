// Sets up the demo server that App Store and Google Play reviewers log in to:
// a second Wardrobe on your Cloudflare account, apart from your own closet,
// filled with the drawn sample closet.
//
//   npx wrangler login               # once
//   npm run demo:server
//
// To give it an AI so reviewers can add clothes (use a key with a low
// spending limit):
//   DEMO_AI_PROVIDER=claude DEMO_AI_KEY=sk-ant-... npm run demo:server
//
// Safe to run again: it reuses what exists, deploys the latest code and makes
// a new token. Needs Workers Paid and Cloudflare Images, like the main server.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = process.env.DEMO_NAME || "wardrobe-demo";
const QUEUE = `${NAME}-jobs`;
const configFile = path.join(root, "wrangler.demo.jsonc");

function wrangler(args, { input, quiet = false, allowFail = false } = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0 && !allowFail) {
    console.error(output);
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
  if (!quiet) process.stdout.write(result.stdout || "");
  return { ok: result.status === 0, output, stdout: result.stdout || "" };
}

const step = (text) => console.log(`\n== ${text}`);

step("Checking your Cloudflare login");
if (!wrangler(["whoami"], { quiet: true, allowFail: true }).output.match(/associated with the email|You are logged in/i)) {
  console.error("Run `npx wrangler login` first.");
  process.exit(1);
}

step(`Making the storage for ${NAME} (skipped where it exists)`);
const bucket = wrangler(["r2", "bucket", "create", NAME], { quiet: true, allowFail: true });
if (!bucket.ok && !/already exists|already own/i.test(bucket.output)) throw new Error(bucket.output);
const queue = wrangler(["queues", "create", QUEUE], { quiet: true, allowFail: true });
if (!queue.ok && !/already (exists|taken)/i.test(queue.output)) throw new Error(queue.output);

const findDatabase = () => {
  const list = JSON.parse(wrangler(["d1", "list", "--json"], { quiet: true }).stdout.replace(/^[^[]*/s, ""));
  return list.find((db) => db.name === NAME)?.uuid;
};
let databaseId = findDatabase();
if (!databaseId) {
  wrangler(["d1", "create", NAME], { quiet: true });
  databaseId = findDatabase();
}
if (!databaseId) throw new Error(`Could not find the ${NAME} database after creating it`);

step("Writing wrangler.demo.jsonc");
const base = (await readFile(path.join(root, "wrangler.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, "");
const config = JSON.parse(base);
config.name = NAME;
config.r2_buckets = [{ binding: "BUCKET", bucket_name: NAME }];
config.d1_databases = [{ ...config.d1_databases[0], database_name: NAME, database_id: databaseId }];
config.queues = {
  producers: [{ binding: "JOBS", queue: QUEUE }],
  consumers: [{ ...config.queues.consumers[0], queue: QUEUE }],
};
await writeFile(configFile, `// Made by scripts/demo-server.mjs. Do not edit.\n${JSON.stringify(config, null, 2)}\n`);

step("Creating the tables");
wrangler(["d1", "migrations", "apply", NAME, "--remote", "-c", configFile], { input: "y\n" });

step("Building and deploying");
execFileSync("npx", ["vite", "build"], { cwd: root, stdio: "inherit" });
const deploy = wrangler(["deploy", "-c", configFile]);
const url = deploy.output.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error("Deployed, but could not find the workers.dev address in wrangler's output");

step("Setting a new access token");
const token = randomBytes(24).toString("base64url");
wrangler(["secret", "put", "WARDROBE_TOKEN", "-c", configFile], { input: `${token}\n`, quiet: true });

async function api(route, method, body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    // A new secret can take up to a minute to reach every Cloudflare location.
    // Until then the Worker answers 503 (no token yet) or 401 (old token).
    if ((response.status === 401 || response.status === 503) && attempt < 30) {
      if (attempt === 0) console.log("Waiting for the new token to reach Cloudflare...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${route}: ${value.error || response.status}`);
    return value;
  }
}

step("Loading the sample closet");
await api("/api/import/settings/ai", "GET");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "wardrobe-demo-"));
try {
  execFileSync("node", [path.join(root, "scripts/sample-closet.mjs"), dataDir], { stdio: "inherit" });
  execFileSync("node", [path.join(root, "scripts/upload-to-cloudflare.mjs"), url], {
    stdio: "inherit",
    env: { ...process.env, WARDROBE_TOKEN: token, WARDROBE_CLOUD_TOKEN: token, WARDROBE_DATA_DIR: dataDir },
  });
} finally {
  await rm(dataDir, { recursive: true, force: true });
}

if (process.env.DEMO_AI_KEY) {
  step("Setting the AI");
  const provider = process.env.DEMO_AI_PROVIDER || "claude";
  await api("/api/import/settings/ai", "PUT", { provider, keys: { [provider]: process.env.DEMO_AI_KEY } });
} else {
  console.log("\nNo DEMO_AI_KEY given, so adding clothes won't work yet. Add a key under the gear icon in the app.");
}

console.log(`
Demo server ready. Put these in the store listing (review demo_user and demo_password):
  Server address: ${url}
  Access token:   ${token}
`);
