# Publishing this project to GitHub

## Option A: GitHub website (no command line)

1. Unzip `wardrobe-web-ios.zip`.
2. On GitHub, click **New repository**, name it (e.g. `wardrobe-web-ios`), leave "Add a README" **unchecked**, and create it.
3. Click **uploading an existing file**, then drag in **everything inside** the unzipped `wardrobe-web-ios` folder (not the folder itself).
   - Hidden files and folders such as `.github`, `.gitignore`, `.dockerignore`, `.gitattributes`, `.env.example`, `.npmrc` and `.claude` must be included. On macOS press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> in Finder to show them.
4. Commit.

> The web uploader has a 100-file limit per upload. If it complains, use option B.

## Option B: Command line (recommended)

```bash
unzip wardrobe-web-ios.zip
cd wardrobe-web-ios
git init -b main
git add .
git commit -m "Wardrobe 2.0: modern redesign, Synology/Docker, iOS connection flow"
git remote add origin https://github.com/<your-user>/wardrobe-web-ios.git
git push -u origin main
```

Or with the GitHub CLI: `gh repo create wardrobe-web-ios --private --source . --push`.

## After pushing

- **Never commit `.env`** (it holds your API key and token). `.gitignore` already excludes it, along with `data/`, `node_modules/` and `dist/`.
- The **Docker image** workflow (`.github/workflows/docker.yml`) runs on every push to `main` and publishes `ghcr.io/<your-user>/wardrobe:latest`.
  - Check it under the repo's **Actions** tab.
  - If the repo is private, the image is private too. Either make the package public (your profile → Packages → wardrobe → Package settings), or log in on the NAS with a personal access token (`read:packages`).
- To use the published image on the NAS, edit `docker-compose.yml`: comment out the `build:` block and uncomment `image: ghcr.io/<your-user>/wardrobe:latest`.
- If your GitHub username isn't `njarrar`, update the clone URL in `README.md` and the image name in `docker-compose.yml`.
