# Releasing to the App Store and Google Play

Publishing a GitHub release builds both apps and uploads them: the iPhone app
to TestFlight, the Android app to the Play internal test track. You then test
them on your phone and send them for review in each store.

## One-time setup

### Apple

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) ($99 a year).
2. In [App Store Connect](https://appstoreconnect.apple.com), create the app:
   **Apps > + > New App**, platform iOS, bundle ID `com.njarrar.wardrobe`
   (register it under Certificates, Identifiers & Profiles first if it is
   not offered), name from `store/app-store.md`.
3. Make an API key: **Users and Access > Integrations > App Store Connect API
   > Team Keys > +**. Give it the **Admin** role (needed so the build can
   create its own signing certificate). Download the `.p8` file; you can
   only download it once.
4. Add these GitHub secrets (repo **Settings > Secrets and variables >
   Actions > New repository secret**):

   | Secret | Where it comes from |
   | --- | --- |
   | `APPLE_TEAM_ID` | developer.apple.com > Account > Membership details > Team ID |
   | `ASC_KEY_ID` | the key's ID in the API keys list |
   | `ASC_ISSUER_ID` | the Issuer ID shown above the keys list |
   | `ASC_KEY_P8` | the whole text of the `.p8` file, including the BEGIN and END lines |

### Google

1. Make a [Play Console](https://play.google.com/console) developer account
   ($25 once) and finish the identity check.
2. Create the app: **Create app**, name from `store/google-play.md`, App,
   Free. Keep **Play App Signing** on (the default).
3. Make an upload key on your computer (needs Java). Keep the file and both
   passwords somewhere safe, such as your password manager:

   ```bash
   keytool -genkeypair -v -keystore wardrobe-upload.jks -alias upload \
     -keyalg RSA -keysize 4096 -validity 10000
   base64 -i wardrobe-upload.jks | pbcopy   # macOS: copies it for the secret
   ```

4. Let GitHub upload builds: in Google Cloud, make a service account with a
   JSON key ([Google's steps](https://developers.google.com/android-publisher/getting_started)),
   then in Play Console **Users and permissions > Invite new users**, add the
   service account's email, and give it **Release to testing tracks** for
   this app.
5. Add these GitHub secrets:

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | the base64 text from step 3 |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `upload` |
   | `ANDROID_KEY_PASSWORD` | the key password |
   | `PLAY_SERVICE_ACCOUNT_JSON` | the whole JSON key file |

6. Google only lets the API upload once the app has one build. The first
   time, run the workflow by hand (below), download the `.aab` from the run's
   **Artifacts**, and upload it yourself in Play Console under **Testing >
   Internal testing > Create new release**.

### The demo server for reviewers

Both stores need a server they can log in to. Deploy the Cloudflare version
(README, "Run it on Cloudflare") as a separate Worker, add a few pieces, set
an AI key with a low spending limit at the AI company, and put its address and
token in the review notes (`store/app-store.md`, `store/google-play.md`).

## Each release

1. Bump the version: `npm version 2.3.0` (this also updates the iPhone and
   Android projects) and push with tags, or ask for a PR that does it.
2. Publish a GitHub release for that version.
3. Watch **Actions > Release apps**. When it is green:
   - iPhone: the build shows in TestFlight after Apple processes it (about
     15 minutes). Install it with the TestFlight app, then in App Store
     Connect add it to the version and press **Add for Review**.
   - Android: the build is on the internal test track. Install it from the
     testing link, then **promote** it to closed testing. Production opens
     only after the 14-day closed test with 12 testers (see
     `store/google-play.md`).

To build without a release (for example to try a fix), open **Actions >
Release apps > Run workflow** and pick the platforms. While the Play app has
never been reviewed, pick `draft` as the Play status.

Build numbers come from the workflow run number, so they always go up.

## Store text, screenshots and graphics

- `store/app-store.md` and `store/google-play.md`: every text field, the
  review notes, and the privacy answers.
- `docs/privacy.md`: the privacy policy both stores link to.
- `store/graphics/`: Play icon and feature graphic
  (`node scripts/store-graphics.mjs` makes them).
- Screenshots: `npm run build`, then
  `node scripts/store-screenshots.mjs` draws a sample closet and saves
  iPhone, iPad and Android screenshots to `store/screenshots/`. To use your real
  closet instead, run it with `WARDROBE_URL=https://your-server
  WARDROBE_TOKEN=... node scripts/store-screenshots.mjs`.
