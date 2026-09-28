---
name: import-clothes
description: Find each garment in a folder of photos, cut it out of its background, and add it to this Wardrobe's local library. Use when the user asks to import, add, or extract clothes from photos into Wardrobe.
---

# Import clothes

Turn photos of clothes (laid flat, hanging, or worn) into clean transparent PNG cutouts and add them to `data/library.json`. You find the garments yourself by looking at the photos, so no Anthropic API key is needed for this skill.

## Before you start

- Get the photo folder from the user unless they gave it. Resolve relative paths from the repository root.
- Check you are in the Wardrobe repo: `package.json` has `"name": "wardrobe"` and `scripts/import-job-api.mjs` exists.
- Check background removal is installed: `node -e "import('@huggingface/transformers').then(() => console.log('ok'))"`. If it fails, tell the user, suggest `npm install @huggingface/transformers`, and offer to go on with `--keep-background` (the crop is kept with its background).
- Work in a temp folder, never inside `data/`:

```bash
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wardrobe-import.XXXXXX")"
mkdir -p "$WORK/items"
```

## 1. Look at every photo

List photos with `rg --files <folder>` (JPEG, PNG, WebP, HEIC, AVIF). Open each one with the Read tool. For each deliberately worn or shown top, jacket, bottom, accessory, and pair of shoes, note:

- a tight box on a 1000 by 1000 grid over the photo: `x,y,width,height`, with x and y at the top left
- a short, specific name
- the category, one of `upperbody` (tops), `wholebody_up` (jackets and outer layers), `lowerbody` (bottoms), `accessories_up`, `shoes`
- the main color as six-digit hex, and a second hex color only when it is truly distinct
- 1 to 4 lowercase detail tags

Treat two sightings as one item only when the photos show it is the same physical piece.

## 2. Cut out each item

Run from the repository root, once per item:

```bash
node .claude/skills/import-clothes/scripts/cut-out.mjs \
  --photo "<photo>" --box "x,y,width,height" --out "$WORK/items/<slug>.png"
```

Add `--keep-background` when background removal is not installed, or when it damages the garment. Slugs are lowercase words joined by hyphens.

## 3. Check the results

Open every PNG in `$WORK/items` with the Read tool and compare it with its photo. Redo an item with a better box when it is cut off, holds a second garment, or shows body parts. Keep an item on hold when it cannot be made clean.

## 4. Write the manifest

Write `$WORK/manifest.json`:

```json
{
  "items": [
    {
      "slug": "navy-fair-isle-cardigan",
      "file": "navy-fair-isle-cardigan.png",
      "name": "Navy Fair Isle Cardigan",
      "part": "wholebody_up",
      "color": "#172033",
      "secondaryColor": "#f2efe6",
      "tags": ["knit", "fair isle"],
      "status": "accepted"
    }
  ]
}
```

Only records with `"status": "accepted"` are imported. Use `null` for `secondaryColor` when there is none.

## 5. Import

If the user did not already ask you to add the clothes, show the names and count first and wait for a yes. Then:

```bash
node .claude/skills/import-clothes/scripts/import-to-wardrobe.mjs \
  --items "$WORK/items" --manifest "$WORK/manifest.json"
```

The script checks each PNG, copies it to `data/imported/`, and updates `data/library.json`. Running it again with the same files updates the records instead of adding copies.

If the app is running, check the new count at `/api/import/wardrobe`. Delete `$WORK` once the import worked.

## Finish

Tell the user how many items you imported, which you held back and why, and show up to 12 of the cutouts. Suggest the style-outfits skill next.
