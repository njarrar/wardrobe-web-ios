# App Store listing

Paste these into App Store Connect. Limits are in brackets.

## App information

- **Name** (30): Wardrobe: AI Closet
- **Subtitle** (30): Your closet on your own server
- **Category**: Lifestyle (secondary: Utilities)
- **Age rating**: 4+ (answer No to every question)
- **Privacy policy URL**: https://github.com/njarrar/wardrobe-web-ios/blob/main/docs/privacy.md
- **Support URL**: https://github.com/njarrar/wardrobe-web-ios/issues

## Version text

**Promotional text** (170)

Snap your clothes, let the AI you pick cut each piece out, and get outfit ideas from what you already own. Your photos stay on your own server.

**Description** (4000)

Wardrobe turns photos of your clothes into a tidy digital closet, then helps you put outfits together from what you already own.

Wardrobe works with your own Wardrobe server. Run it on a Synology NAS or another computer at home, or on your own Cloudflare account. The free setup guide is linked in the app. Your photos and closet stay on that server, not with us.

ADD CLOTHES IN SECONDS
- Take a photo or pick one from your library. One piece or a whole outfit both work.
- The AI finds each piece, cuts it out, and suggests a name, colors and tags.
- You check each piece before it joins your closet.

FIND ANYTHING
- Browse by tops, jackets, bottoms, shoes and accessories.
- Filter by color, or search by name, color or detail.
- Edit names, colors and tags at any time.

OUTFITS
- Ask for outfit ideas for a weekend in the city, the office, or a rainy day.
- Build your own outfits by hand.
- Filter outfits by occasion.

YOUR AI, YOUR KEY
- Pick Claude, ChatGPT or Gemini in Settings and use your own API key.
- The app asks before any photo is sent to an AI.

PRIVATE BY DESIGN
- No account with us, no ads, no tracking.
- Works in light and dark mode.

You need a Wardrobe server and an API key for the AI you pick.

**Keywords** (100)

closet,wardrobe,outfit,clothes,style,fashion,stylist,organizer,self-hosted,nas,synology,ai

**What's new**

First release on the App Store.

## App Review information

- **Sign-in required**: Yes
- **User name**: the demo server address, for example `https://wardrobe-demo.<your-subdomain>.workers.dev`
- **Password**: the demo server's WARDROBE_TOKEN
- **Notes**:

  Wardrobe is a companion app for a server the user runs themselves (a NAS, a computer, or their own Cloudflare account), like a Home Assistant or Jellyfin app. We set up a demo server for review.

  1. Open the app. On the first screen enter the address above as "Server address" and the password above as "Access token", then tap Connect.
  2. The demo closet loads. Tap any piece to see and edit it.
  3. Tap Add clothes, then take or choose a photo of a piece of clothing. The app first asks permission to send the photo to the AI picked in Settings (Claude). Tap Allow. The piece is found, cut out and shown for review.
  4. Open the Outfits tab and tap Style new outfits for outfit ideas.

  The app has no account system with us and collects no data. Photos go only to the user's own server and, after the user agrees, to the AI service they picked with their own API key.

## App Privacy

Answer **Data Not Collected**. We (the developer) never receive any data:
the app talks only to the server the user runs, and that server sends data to
an AI service only under the user's own account and API key, after the user
agrees in the app. If Apple asks about this in review, point to the review
notes above.

## Screenshots

Required: 6.9-inch iPhone, 1320 x 2868. Make them with
`node scripts/store-screenshots.mjs` (see store/README.md).
If you keep iPad support, 13-inch iPad screenshots are also required.

## Export compliance

Already answered in the app (ITSAppUsesNonExemptEncryption = NO): it uses only
the standard HTTPS built into iOS.
