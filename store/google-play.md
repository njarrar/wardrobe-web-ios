# Google Play listing

Paste these into Play Console. Limits are in brackets.

## Main store listing

- **App name** (30): Wardrobe: AI Closet
- **Short description** (80): Your clothes, cut out and styled by AI. Kept on your own server.
- **App icon**: 512 x 512 PNG, `store/graphics/play-icon-512.png`
- **Feature graphic**: 1024 x 500 PNG, `store/graphics/play-feature-1024x500.png`
- **Phone screenshots**: 2 to 8, from `node scripts/store-screenshots.mjs`
- **Category**: Lifestyle
- **Email**: njarrar+closetplay@gmail.com
- **Website**: https://github.com/njarrar/wardrobe-web-ios
- **Privacy policy**: https://github.com/njarrar/wardrobe-web-ios/blob/main/docs/privacy.md

**Full description** (4000): use the App Store description in
`store/app-store.md`; it fits.

## App content

- **App access**: All or some functionality is restricted. Add instructions:
  name "Demo server", user name = demo server address, password = demo
  WARDROBE_TOKEN, and the same steps as the App Store review notes.
- **Ads**: No ads.
- **Content rating**: questionnaire, category "Utility, Productivity,
  Communication, or Other". Answer No to everything. Expect "Everyone".
- **Target audience**: 13 and over (not designed for children).
- **News app**: No.
- **Health apps / financial features / government app**: No.

## Data safety

- **Does your app collect or share any of the required user data types?** No.

Why: Google counts data as collected when it is sent off the device to you
(the developer) or a third party. Wardrobe sends photos only to the server the
user runs and, after the user agrees, from that server to the AI service the
user picked with their own key. We never receive anything. Data the user
sends to a service of their own choosing, on their own action, is not
"shared" in Google's terms.

- **Is all of the user data collected by your app encrypted in transit?**
  Not applicable when you answer No above. (Home Wi-Fi connections to a NAS by
  IP can be plain http; HTTPS addresses are encrypted.)
- **Do you provide a way for users to request that their data is deleted?**
  Not applicable. Users delete pieces and outfits in the app, on their own
  server.

## Testing before production

Your developer account is a personal account made after 13 November 2023, so
Google needs a **closed test with at least 12 testers who stay opted in for
14 days in a row** before you can apply for production. This is the slowest
step, so start it as soon as the first build is in Play Console:

1. **Testing > Closed testing > Create track**, add the first build.
2. Add at least 12 testers by email (a Google Group is easiest) and send them
   the opt-in link. They must install the app and stay opted in.
3. After 14 days, **Dashboard > Apply for production** and answer Google's
   questions about the test.
