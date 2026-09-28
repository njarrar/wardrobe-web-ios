# Changelog

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
