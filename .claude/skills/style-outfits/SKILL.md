---
name: style-outfits
description: Put together complete outfits from the clothes already in this Wardrobe and save them to the Outfits tab. Use when the user asks for outfit ideas, looks, combinations, or a lookbook from their Wardrobe.
---

# Style outfits

Build outfits from `data/library.json` and save them to `data/outfits.json`. The app shows each one on the Outfits tab as a collage of its garment cutouts. The app's own "Style new outfits" button does the same through the AI picked in Settings (Claude, ChatGPT or Gemini); this skill does it in Claude Code with no API key.

## Before you start

- Ask how many outfits the user wants unless they said. Note any season, occasion, or mood they named. Without one, aim for an everyday mix.
- Read `data/library.json`. Each record has `id`, `name`, `part`, `color`, `secondaryColor`, and `tags`. Garment images live in `data/imported/`; a record's image `/api/import/library/FILE` is the file `data/imported/FILE`.
- Read `data/outfits.json` if it exists (`{ "version": 1, "outfits": [...] }`, or a bare array in older files) so you do not repeat a combination.

## 1. Look at the clothes

Open the garment PNGs with the Read tool. Style from what you see as well as the names and colors.

If the wardrobe cannot make the number asked for without repeats, say how many it can make and ask whether to go on.

## 2. Build the outfits

Each outfit has exactly one `upperbody` piece and one `lowerbody` piece. It may add one outer layer (`wholebody_up`), one pair of `shoes`, and one accessory (`accessories_up`).

- Favor tonal or nearby colors for a calm look, and use contrast on purpose with one color in charge.
- Let one pattern, graphic, texture, or bright piece carry the look.
- Balance the shapes: fuller bottoms with a cleaner top, heavy layers over a simple base.
- Spread the pieces across outfits instead of leaning on the same easy basics.
- Cover a mix of occasions: casual, smart casual, work, evening, warm or cold weather.

## 3. Save

Append each outfit to `data/outfits.json`, keeping every existing entry:

```json
{
  "version": 1,
  "outfits": [
    {
      "id": "navy-camel-classic",
      "name": "Navy & Camel Classic",
      "occasion": ["smart casual", "work"],
      "garmentIds": ["import-...", "import-..."],
      "reason": "Deep navy and camel give a calm warm and cool contrast.",
      "image": null
    }
  ]
}
```

Ids are lowercase words joined by hyphens and must be unique. Every garment id must exist in `data/library.json`. Write the file in one go (write a temp file, then rename it) so a running app never reads half a file.

## Finish

List the outfits with their pieces and a line on each. Tell the user to open the Outfits tab to see them.
