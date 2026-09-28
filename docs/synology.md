# Run Wardrobe on a Synology NAS

Your closet — photos, cutouts, `library.json`, `outfits.json` — lives in one folder on
your NAS. The web app and the iPhone app both talk to the same container.

```text
 iPhone app ─┐                        ┌──────────── Synology NAS ────────────┐
 Browser ────┼── http(s)://NAS:4173 ──▶  wardrobe container  ──▶  /volume1/docker/wardrobe/data
 (any device)┘                        └──────────────────────────────────────┘
```

## What you need

- DSM 7.2 or newer with **Container Manager** (Package Center). DSM 7.1 users: the
  older **Docker** package works the same way with `docker-compose`.
- An Intel/AMD **or** ARM64 Synology (for example DS224+, DS423+, DS923+, DS1522+,
  DS220j/DS223j on ARM64). 2 GB RAM or more is recommended for on-device background
  removal; 1 GB models should build with `WITH_CUTOUT: "false"`.
- An Anthropic API key (for finding clothes and styling outfits).

## 1. Put the project on the NAS

1. In **File Station**, create `docker/wardrobe` on `volume1` (Container Manager
   creates the `docker` shared folder for you).
2. Upload this project into `/volume1/docker/wardrobe` (unzip it there, or
   `git clone` over SSH).
3. Copy `.env.example` to `.env` and set at least:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   WARDROBE_TOKEN=<a long random string>   # e.g. from: openssl rand -hex 24
   ```

   Optionally set `PUID`/`PGID` to your DSM user (SSH in and run `id`; the first
   admin account is usually `1026:100`) so you can open the files in File Station.

## 2. Create the project in Container Manager

1. **Container Manager → Project → Create**.
2. Name: `wardrobe`. Path: `/docker/wardrobe`. Choose **Use existing
   docker-compose.yml**.
3. Click **Next → Done**. The first build takes a few minutes (it downloads
   Node and the app's dependencies). Later updates are much faster.

Prefer not to build on the NAS? Publish the image with the included GitHub
workflow (`.github/workflows/docker.yml`), then in `docker-compose.yml` replace the
`build:` block with `image: ghcr.io/<you>/wardrobe:latest`.

Command line equivalent (over SSH):

```bash
cd /volume1/docker/wardrobe
sudo docker compose up -d --build
sudo docker compose logs -f
```

## 3. Open it

- Browser on your home network: `http://<NAS-IP>:4173` → enter your token once.
- iPhone app: on first launch enter `http://<NAS-IP>:4173` (or `nas-name.local:4173`)
  and the same token. The app checks the connection before saving it and you can
  switch servers later under **Settings** (gear icon).

> Tip: give the NAS a fixed IP (DHCP reservation on your router) so the address
> never changes.

## 4. Use it away from home (optional)

Pick one:

| Option | How | Notes |
| --- | --- | --- |
| **HTTPS via DSM reverse proxy** (recommended) | Control Panel → External Access → DDNS: create `yourname.synology.me`. Control Panel → Security → Certificate: add a Let's Encrypt cert for `wardrobe.yourname.synology.me`. Control Panel → Login Portal → Advanced → Reverse Proxy → Create: source `HTTPS` `wardrobe.yourname.synology.me` `443` → destination `HTTP` `localhost` `4173`. Forward port 443 on your router. | Use `https://wardrobe.yourname.synology.me` in the app. Photos upload up to ~25 MB, so under **Custom Header** nothing extra is needed; if uploads fail, raise the proxy timeout to 300 s. |
| **Tailscale** | Install the Tailscale package on the NAS and the Tailscale app on your iPhone. | Nothing exposed to the internet. Use `http://<nas-tailscale-name>:4173`. |
| **VPN Server package** | Connect the phone with WireGuard/OpenVPN, then use the LAN address. | Also private. |

QuickConnect does not relay custom container ports, so it cannot be used for this app.

## Your data and backups

Everything lives in `/volume1/docker/wardrobe/data`:

| Path | Contents |
| --- | --- |
| `library.json` | Every piece: name, category, colors, tags |
| `outfits.json` | Outfits styled by Claude |
| `imported/` | Garment cutouts (PNG) |
| `jobs/` | Imports waiting for your review |
| `models/` | Background-removal model (~200 MB, downloaded on first import) |

Protect it with **Snapshot Replication** and/or **Hyper Backup**. `models/` can be
excluded — it re-downloads automatically.

## Updating

Replace the project files with the new version (keep `.env` and `data/`), then
**Container Manager → Project → wardrobe → Action → Build** (or
`sudo docker compose up -d --build`). With a published image: **Action → Stop**,
**Image → Update**, **Action → Start**.

## Moving a closet you already built

Copy your existing `data/` folder (from a computer running `npm start`) into
`/volume1/docker/wardrobe/data` before starting the container. To copy to
Cloudflare instead, see `npm run cf:upload` in the README.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Container stops with "Refusing to listen … without WARDROBE_TOKEN" | Set `WARDROBE_TOKEN` in `.env`, then rebuild/restart the project. |
| "Setup required" when adding clothes | `ANTHROPIC_API_KEY` is missing from `.env`. |
| `EACCES: permission denied` in the logs | Set `PUID`/`PGID` to your DSM user, or give that user read/write on `docker/wardrobe/data`. |
| iPhone app says it cannot reach the server | Check the IP/port in a Safari tab first: `http://<NAS-IP>:4173/api/health` should show `{"ok":true,…}`. Make sure the phone is on the same Wi-Fi (or Tailscale/VPN). Allow port 4173 in Control Panel → Security → Firewall if the firewall is on. |
| Cutouts fail or the container restarts during an import | The NAS ran out of memory. Raise `mem_limit`, or rebuild with `WITH_CUTOUT: "false"` and use **Keep background**. |
