# Changelog

## 3.0.3 (busy AI, no zoom)

- **A busy AI is tried again.** When Claude, ChatGPT or Gemini says it is overloaded, the app waits and tries twice more. If it is still busy, the message says so in plain words and tells you to try again or pick another AI.
- **The phone app no longer zooms.** Tapping a text field made iOS zoom the screen, which cut off the top and the sides and stayed that way. Fields now use 16px text and the app screen is fixed at its own size.
- Sheets keep a little more room from the screen edges.
- **Reading your photo.** After you pick photos, the sheet now says the AI is reading them ("Reading photo 1 of 2") until the pieces show up. Before, it showed nothing for up to a minute, which looked as if nothing had happened.

## 3.0.2 (review fixes)

- **Arabic:** the AI help text, occasion chips, group names, import hints and the AI consent screen are now translated. A test fails when a screen shows text that is not set up for translation.
- **Import:** one review per piece. The crop is approved for you; you check the finished piece once.
- **Move to iCloud:** a picture that fails to copy is tried three times. If any still fail, the app says how many and stays on the server, so nothing goes missing. Trying again skips pictures already copied.
- **Server token:** on iPhone and iPad it is kept in the Keychain, not in the web store. An old saved token moves over on first start.
- **Faster start:** the iCloud code loads only when iCloud mode is on.
- **Settings:** "Add basics, no photo" is gone from Settings. It stays on the Closet tab.

## 3.0.1 (safer iCloud)

### iCloud closet
- **Two devices no longer overwrite each other.** Each piece and outfit keeps the time it last changed. When iCloud holds two copies of the closet, the app joins them piece by piece. A removed piece stays removed.
- **A new device waits for iCloud** to list the closet before it shows anything ("Checking iCloud"), so it never starts from an empty closet by mistake.
- **The closet reloads** when you come back to the app and when iCloud brings changes from another device.
- **Pictures still in iCloud** are fetched and shown, not left broken.
- Imports in progress stay on the device and no longer sync.

### Look
- **Dark mode:** piece pictures sit on a mid grey tile, so black and navy clothes show.
- **Add clothes** is a round button on the Closet tab and is hidden on Outfits and Plan unless an import is running.

## 3.0.0 (iCloud closet)

### No server needed
- **Use iCloud** on the first screen of the iPhone and iPad app. Pieces, pictures, outfits and the plan are saved as files in the app's own iCloud Drive folder and sync to your other Apple devices. Without iCloud Drive they stay on the device.
- Everything the server does works here too: importing photos, styling, sorting, the plan, wear log, basics and Fix edges.
- **The AI is called from the phone.** Paste your Claude, ChatGPT or Gemini key in Settings; it is kept in the Keychain and synced by iCloud Keychain. Requests go straight to the AI company through the app's own HTTP.
- **Cutouts on the phone.** Approving a crop cuts the piece out with Apple's Vision (iOS 17 and later). On older iOS the crop is kept as is.

### Moving
- **Settings > Where your closet lives.** Copy a closet from your server into iCloud (the server keeps its copy), or switch back to a server. AI keys are not copied; add yours again after the move.

### Under the hood
- `src/local/` holds the serverless API (`backend.js`, the same routes and shared rules as the servers), the stores (`store.js`: iCloud files, a browser database, or memory for tests) and the move (`migrate.js`).
- New iOS plugin `CloudStore` (files with `NSFileCoordinator`, iCloud downloads, Keychain). The app now has iCloud entitlements (`App.entitlements`).
- `shared/ai.mjs` takes an optional `fetch` per call.

## 2.6.0 (Arabic, weather and picture fixes)

### Arabic
- **The whole app in Arabic**, with the layout turned right to left. Pick English or العربية in Settings. A phone set to Arabic starts in Arabic.
- Dates, weekdays and counts follow the language. Piece names you typed keep their own direction.

### Weather
- **Weather in Settings**, off by default. Use your location or type a city.
- With it on, the Today card and the month plan pick warmer or lighter outfits from the forecast, and rainy days avoid suede and linen.
- The forecast comes from Open-Meteo, straight from the device, with the location rounded to about 10 km. It is never sent to your server.

### Adding clothes
- **Add basics without a photo.** Pick from 19 basics (tee, oxford, jeans, chinos, blazer, coat, sneakers and more), choose a color and tap Add. They come sorted and ready for outfits and plans. Swap in a real photo later.
- **Clean cut on iPhone.** On iOS 17 or later, the piece page can cut the piece out again with Apple's on-device Vision. Nothing leaves the phone except the finished picture.
- **Fix edges.** A brush on the piece page to erase leftover background or bring back parts of the piece, with undo. Works on every device.

### API
- `POST /api/import/wardrobe` adds a piece with its own PNG (`imageDataUrl`) and details.
- `PUT /api/import/wardrobe/:id/image` swaps a piece's picture. Each picture gets a new file name, so cached copies never show the old one, and the old file is removed.
- Both take PNG only, up to 8 MB.

### Phone apps
- iOS asks for location only when you tap Use my location (`NSLocationWhenInUseUsageDescription`). Android asks for rough location only.
- The iOS app now starts from `WardrobeViewController`, which adds the on-device cutout.

## 2.5.0 (Plan and sort)

### Plan
- **New Plan tab** with week and month views.
- **Plan the whole month in one tap.** Every empty day gets a saved outfit. No outfit comes back inside 7 days (you can pick 3 to 21), the same top never shows two days running, work days lean on work outfits, and pieces that have sat for a while get a turn. Tap any day to swap or clear it.
- **Plan rules:** your work days, the rest time, and whether to mix in forgotten pieces.
- **Trips.** Add a trip with dates, plan its days, and get a packing list with a tick box for each piece.
- The Today card shows the planned outfit when there is one.
- The plan is planned on the device. It costs no AI call.

### Auto sort
- New photos come back with a kind (tee, sweater, boots), the seasons they suit, warmth from 1 to 5 and a dress level.
- **Sort N pieces for me** fills these in for older pieces from their names, colors and tags. No photos are sent.
- **Smart groups** under the color dots: Winter, Summer, Spring and fall, Work, Casual and Neutrals.
- Edit kind, warmth, dress level and seasons on each piece. Search finds them too.

### Look
- **Glass look.** See-through bars and cards over a soft color wash, a floating tab bar on phones, and a light spring when you press. The garment grid stays solid so scrolling stays smooth. Reduce Transparency and Reduce Motion turn the effects off.

### API
- `GET` and `PUT /api/import/plan` (`data/plan.json` on a computer or NAS, the `settings` table on Cloudflare, so no migration).
- `POST /api/import/wardrobe/sort` (send `{ "all": true }` to sort every piece again).
- Items can carry `kind`, `seasons`, `warmth` and `formality`.

## 2.4.0 (Wear and color)

### Closet
- **Today card.** One saved outfit for today, picked from outfits you have not worn in the last 7 days and leaning on pieces that have sat for a while. **Wear this** logs it; **Shuffle** picks another on the device, with no AI call.
- **Not worn in a while.** A row of pieces nobody has worn for 60 days or more, longest first. A piece never worn counts from the day it was added.
- **Wear log.** **Wore today** on a piece, **Wore it today** on an outfit. Logging an outfit logs every piece in it. Tap again to undo.
- **Cost per wear.** Add what you paid for a piece. Its page shows times worn, last worn and cost per wear.

### Outfits
- **Color wheel rules.** Pick Auto, Tonal, Neighbors, Opposites or Three-way before styling. The AI gets the rule, the server checks every outfit on the color wheel, drops clashes and puts the asked-for rule first. Black, white, grey, beige, camel, brown and navy count as neutrals.
- Each outfit shows its rule and a score out of 100.
- **Use pieces I haven't worn lately** asks the AI to build on the forgotten pieces.

### API
- `PATCH /api/import/wardrobe/:id` takes `price`, and `wear` or `unwear` with a date like `2026-11-18`.
- `PATCH /api/import/outfits/:id` takes `wear` and `unwear`.
- `POST /api/import/outfits/generate` takes `rule` (`tonal`, `neighbors`, `opposites`, `three-way`) and `preferIds`.
- New `shared/style.mjs` holds the color wheel, wear log and planning logic for the app and both servers.

## 2.3.0 (Ready for the app stores)

### Phone apps
- New Android app in `android/` (Capacitor, target SDK 36), with the same icon as iOS. It can reach a NAS by IP over plain http on home Wi-Fi.
- iOS: requires `arm64` instead of `armv7`, declares standard encryption only, adds a privacy manifest and a shared scheme. iPhone and iPad.
- The app version now follows `package.json`. `npm version` updates the iOS and Android projects too, and `npm run check` fails if they drift.

### Screens
- Phones: Closet and Outfits move to a bottom tab bar, and the header scrolls with the page.
- First run in the phone app says what you need and links to the setup guide.
- Before the first photo or outfit request goes to an AI, the app asks for permission and names the company and its privacy policy.
- With no AI key, the add button still says Add clothes and explains the key when tapped. Style new outfits waits for a key.
- The chosen view is clear in dark mode. Plainer wording, no long dashes.

### Security
- Image links carry a 12-hour image key instead of the access token. The server and the Worker no longer take the token in a link.
- New `GET /api/import/image-key`.
- Vite 6.4.5 and sharp 0.35.5 for known security issues.

### Releases
- `Release apps` workflow: a GitHub release builds both apps and uploads them to TestFlight and the Google Play internal track.
- Privacy policy in `docs/privacy.md`.
- `npm run store:screenshots` makes iPhone, iPad and Android screenshots from a drawn sample closet or your own server. `npm run store:graphics` makes the Play icon and feature graphic.

### Tests
- `npm run test:ui` opens the built app at phone size in light and dark mode. CI runs it, and builds the iOS app (simulator) and the Android app on every pull request.

### Fixes
- The Docker image workflow failed with `denied: permission_denied` because every copy of this repo pushed to the same `ghcr.io/<owner>/wardrobe` package, which belongs to only one of them. The image is now named after the repository, for example `ghcr.io/njarrar/wardrobe-najeeb`.

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
