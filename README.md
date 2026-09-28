<div align="center">

# Wardrobe

Your clothes, extracted and organized with gpt-image.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

Based on [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe). [See the original post →](https://x.com/cdngdev/status/2076812846793650485)

</div>

![Wardrobe gallery](docs/screenshots/gallery.png)

![Modeled wardrobe editor](docs/screenshots/editor.png)

## Quick start

```bash
git clone https://github.com/njarrar/wardrobe-najeeb.git
cd wardrobe-najeeb
npm install
cp .env.example .env
npm run dev
```

To run the built app instead of the dev server:

```bash
npm run build
npm start          # http://localhost:4173
```

⚠️ The importer stays disabled until you add `OPENAI_API_KEY` to `.env` and place a PNG reference photo of yourself at `data/model-reference.png`.

Open [localhost:5173](http://localhost:5173).

### Use it from your phone

The server only listens on this computer by default. To reach it from another device on your network, set both of these in `.env`:

```bash
WARDROBE_HOST=0.0.0.0
WARDROBE_TOKEN=pick-a-long-random-string
```

The server refuses to listen on your network without a token. Browsers and the app ask for the token once and remember it.

## Run it on Cloudflare

Instead of keeping everything on your computer, you can run Wardrobe on Cloudflare. Photos and images go in R2, your closet and outfits go in D1, and the slow AI steps run from a Queue. The app, the iPhone app and phone browsers all talk to the same Worker, so your closet is the same everywhere.

You need:

- A Cloudflare account on the **Workers Paid** plan ($5 a month). Queues need it, and cleaning up each garment image takes more CPU time than the free plan allows.
- An OpenAI API key.

One-time setup:

```bash
npx wrangler login
npx wrangler r2 bucket create wardrobe
npx wrangler d1 create wardrobe        # copy the database_id it prints into wrangler.jsonc
npx wrangler queues create wardrobe-jobs
npm run cf:migrate                     # creates the tables
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put WARDROBE_TOKEN # pick a long random string
npm run cf:deploy
```

Open the `workers.dev` address it prints, enter your token, and upload a photo of yourself when the app asks. To copy a closet you already built locally (including anything the Codex skills made), run:

```bash
WARDROBE_TOKEN=your-token npm run cf:upload -- https://wardrobe.your-name.workers.dev
```

Run `npm run cf:deploy` again after each update. To try the Worker on your computer first, put `WARDROBE_TOKEN` and `OPENAI_API_KEY` in `.dev.vars`, run `npx wrangler d1 migrations apply wardrobe --local`, then `npm run cf:dev`.

## Take photos from your phone

On a phone, the add button offers **Take photo** next to **Choose images**. It opens the camera straight away in the iPhone app and in phone browsers. Photos are turned upright and shrunk to 2048px before upload.

## iPhone app

The `ios/` folder holds a Capacitor app that shows the same closet. Point it at your Cloudflare Worker (easiest, works anywhere) or at the server on your computer. For the computer, set `WARDROBE_HOST=0.0.0.0` and `WARDROBE_TOKEN` first (see above), then run `npm start` there.

To build it you need a Mac with Xcode 16 or newer:

```bash
npm install
npm run ios        # builds the web app, copies it into ios/, opens Xcode
```

In Xcode pick your team under Signing & Capabilities, choose your iPhone, and press Run. On first launch the app asks for the server address (your `https://…workers.dev` address, or for example `http://192.168.1.20:4173`) and the token. You can browse, edit, delete, add photos from your library or camera, and view outfits.

## Import with Codex

This repo includes two Codex skills: one imports clothes and generates modeled item photos; the other styles complete outfits and generates a modeled lookbook.

```text
$import-clothes Import the clothes from ~/Pictures/outfits, create modeled photos, and add them to this wardrobe.
$generate-outfits Create modeled outfit ideas from my wardrobe.
```

Open the cloned repo in Codex and run either prompt. The import skill asks for a local model-reference PNG when needed, reviews every cutout and modeled photo, then writes to `data/library.json` and `data/imported/`. The outfit skill asks how many looks to create, then curates, generates, verifies, and saves the complete collection under `data/`.

### For agents

If you are setting up Wardrobe for a user, ask how they want to import their clothes:

- **Codex:** Ask for a folder or camera-roll location and a model-reference PNG, then extract, model, and import the individual pieces by following [the bundled import skill](.agents/skills/import-clothes/SKILL.md). Afterward, offer to create a requested number of modeled looks with [the outfit-generation skill](.agents/skills/generate-outfits/SKILL.md).
- **Web UI:** Help the user configure their own `OPENAI_API_KEY` and `data/model-reference.png`, then let them import through the app.

## What it does

- Detects every garment in a photo with the OpenAI Responses API
- Extracts clean product cutouts with the OpenAI Images API
- Generates an optional modeled editorial preview
- Keeps originals, jobs, generated images, and the JSON database local in `data/`
- Supports drag, drop, paste, editing, review, regeneration, and approval
- Saves your edits to names, colors, and tags in `data/library.json`
- Shows outfits from the outfit skill in an Outfits tab

## Configuration

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Required |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `high` |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` |
| `WARDROBE_DATA_DIR` | `data` |
| `WARDROBE_HOST` | `127.0.0.1` |
| `WARDROBE_TOKEN` | Required when `WARDROBE_HOST` is not local |
| `PORT` | `4173` (for `npm start`) |

## Tests

```bash
npm test
```

## License

[MIT](LICENSE)
