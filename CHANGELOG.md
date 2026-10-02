# Changelog

## 2.2.0 (Pick your AI)

### AI
- Pick Claude, ChatGPT (OpenAI) or Gemini (Google) in Settings to find clothes in photos and style outfits.
- Paste an API key for each one in the app. No need to edit `.env` or restart.
- Change the model for each AI, or leave it empty for the default (`claude-opus-5`, `gpt-6.1-sol`, `gemini-3.8-flash`).
- Keys stay on the server: `data/settings.json` (owner-only file) on a computer or NAS, the new D1 `settings` table on Cloudflare. The browser only ever sees the last four characters.
- Keys in `.env` or Worker secrets still work: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, plus `WARDROBE_AI_PROVIDER` and a model setting for each.
- New `GET` and `PUT /api/import/settings/ai`. `PUT` only takes JSON, so other web pages cannot change your keys.
- A key the AI rejects now shows a clear message instead of signing the app out.

### Cloudflare
- Run `npm run cf:migrate` before deploying 2.2. It adds the `settings` table.

### Other
- `shared/claude.mjs` is now `shared/ai.mjs`; the test stand-in (`test/mock-ai.mjs`) speaks all three APIs.
- App text says "the AI" where it used to say "Claude".

## 2.1.0 — Outfit builder and color filter

### Outfits
- Build an outfit by hand: pick pieces, name it, add occasions and a note (`POST /api/import/outfits`).
- Edit an outfit's name, occasions and note (`PATCH /api/import/outfits/:id`). The pieces never change.
- Filter outfits by occasion, and quick idea chips for the styling note.
- Tap a piece in an outfit to open it.

### Closet
- Filter by color family (black, blue, beige and so on). Search now matches these words too, so "blue" finds navy pieces.

### Fixes
- Settings shows whether the server asks for a token, as the server reports it, not whether this device saved one.
- `/api/health` now also answers in `npm run dev` and on the Cloudflare Worker, and Worker imports record `addedAt`.
- The page no longer scrolls behind an open outfit, and the import button hides while a dialog is open.
- Category and occasion chips no longer snap under the screen edge on phones.

### Docs
- README rewritten for 2.1 with new screenshots: color filter, outfit, outfit builder and phone outfits.

## 2.0.0 — Modern redesign and self-hosting

### Design
- New look built on design tokens, with automatic light and dark mode.
- Frosted sticky top bar with Closet / Outfits switch and a settings button.
- Search across name, tags, category and colour; sort by category, newest, colour (by hue) or name. Sort choice is remembered.
- Category chips with item counts, item cards with colour swatches, skeleton loading and friendly empty states.
- Item details open in a floating side sheet on desktop and a bottom sheet on phones, with a sticky Save bar.

### Self-hosting (Synology NAS / Docker)
- `Dockerfile` (multi-stage, Node 22), `docker-compose.yml` and `docker/entrypoint.sh`.
- All data (closet, photos, cutouts, outfits, model cache) in one `/data` volume.
- `PUID` / `PGID` so files on the NAS belong to your DSM user.
- `GET /api/health` endpoint (no token) used by the Docker health check.
- Graceful shutdown on stop, longer request timeout for large uploads.
- GitHub Actions workflow publishing a multi-arch image (amd64 + arm64) to GHCR.
- Step-by-step guide in [docs/synology.md](docs/synology.md): Container Manager, HTTPS reverse proxy, Tailscale, backups, troubleshooting.

### iPhone app
- Redesigned connect screen that tests the server and token before saving, with clear error messages and NAS / HTTPS examples.
- New settings sheet: connection status, storage, AI readiness, switch server or forget token.

### Other
- New items record when they were added (`addedAt`) for "Recently added" sorting.
- Updated app manifest, theme colours and README.

## 1.0.0
- Original web + iOS wardrobe app, based on [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe).
