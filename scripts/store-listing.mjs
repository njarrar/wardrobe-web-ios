// Turns the private store listing (JSON) into the folders fastlane reads,
// checks each field against the store limits, and copies in the screenshots
// and Play graphics.
//
//   STORE_LISTING_JSON="$(cat listing.json)" node scripts/store-listing.mjs
//   node scripts/store-listing.mjs path/to/listing.json
//
// Writes fastlane/ios/ and fastlane/android/ (both ignored by git). Run
// `npm run store:screenshots` first so store/screenshots/ is filled.
//
// The listing is kept out of this repo. Its shape:
// {
//   "version": "2.3.0",            // optional, defaults to package.json
//   "ios": {
//     "name", "subtitle", "promotional_text", "description", "keywords",
//     "release_notes", "privacy_url", "support_url", "marketing_url",
//     "copyright", "primary_category", "secondary_category", "age_rating" (optional),
//     "review": { "first_name", "last_name", "phone_number", "email_address",
//                 "demo_user", "demo_password", "notes" }
//   },
//   "android": { "title", "short_description", "full_description" }
// }
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "store/screenshots");
const graphics = path.join(root, "store/graphics");
const out = path.join(root, "fastlane");

const raw = process.argv[2] ? await readFile(process.argv[2], "utf8") : process.env.STORE_LISTING_JSON;
if (!raw) {
  console.error("Give the listing as a file path or in STORE_LISTING_JSON.");
  process.exit(1);
}
const listing = JSON.parse(raw);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = listing.version || pkg.version;

const IOS_LIMITS = { name: 30, subtitle: 30, promotional_text: 170, description: 4000, keywords: 100, release_notes: 4000 };
const ANDROID_LIMITS = { title: 30, short_description: 80, full_description: 4000 };
const problems = [];
function check(store, fields, limits, required) {
  for (const key of required) if (!fields?.[key]?.trim()) problems.push(`${store}.${key} is missing`);
  for (const [key, max] of Object.entries(limits)) {
    const length = [...(fields?.[key] || "")].length;
    if (length > max) problems.push(`${store}.${key} is ${length} characters (limit ${max})`);
  }
}
if (listing.ios) {
  check("ios", listing.ios, IOS_LIMITS, ["name", "description", "keywords", "privacy_url", "support_url"]);
  const review = listing.ios.review || {};
  for (const key of ["first_name", "last_name", "phone_number", "email_address", "demo_user", "demo_password", "notes"]) {
    if (!review[key]?.trim()) problems.push(`ios.review.${key} is missing`);
  }
}
if (listing.android) check("android", listing.android, ANDROID_LIMITS, ["title", "short_description", "full_description"]);
if (!listing.ios && !listing.android) problems.push("the listing has neither ios nor android");

const files = await readdir(shots).catch(() => []);
const pick = (prefix) => files.filter((name) => name.startsWith(`${prefix}-light-`) && name.endsWith(".png")).sort();
if (listing.ios && (!pick("iphone").length || !pick("ipad").length)) problems.push("no iPhone or iPad screenshots; run npm run store:screenshots");
if (listing.android && pick("android").length < 2) problems.push("Play needs at least 2 phone screenshots; run npm run store:screenshots");

if (problems.length) {
  console.error(`Fix the listing first:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

async function write(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${String(text).trim()}\n`);
}

if (listing.ios) {
  const ios = listing.ios;
  const dir = path.join(out, "ios");
  await rm(dir, { recursive: true, force: true });
  const meta = path.join(dir, "metadata");
  for (const key of ["name", "subtitle", "promotional_text", "description", "keywords", "release_notes", "privacy_url", "support_url", "marketing_url"]) {
    if (ios[key]) await write(path.join(meta, "en-US", `${key}.txt`), ios[key]);
  }
  for (const key of ["copyright", "primary_category", "secondary_category"]) {
    if (ios[key]) await write(path.join(meta, `${key}.txt`), ios[key]);
  }
  for (const [key, value] of Object.entries(ios.review)) await write(path.join(meta, "review_information", `${key}.txt`), value);
  const shotDir = path.join(dir, "screenshots", "en-US");
  await mkdir(shotDir, { recursive: true });
  for (const name of [...pick("iphone"), ...pick("ipad")]) await copyFile(path.join(shots, name), path.join(shotDir, name));
  console.log(`App Store ${version}: text and ${pick("iphone").length + pick("ipad").length} screenshots in fastlane/ios/`);
}

if (listing.android) {
  const android = listing.android;
  const dir = path.join(out, "android");
  await rm(dir, { recursive: true, force: true });
  const lang = path.join(dir, "en-US");
  for (const key of ["title", "short_description", "full_description"]) await write(path.join(lang, `${key}.txt`), android[key]);
  await mkdir(path.join(lang, "images", "phoneScreenshots"), { recursive: true });
  await copyFile(path.join(graphics, "play-icon-512.png"), path.join(lang, "images", "icon.png"));
  await copyFile(path.join(graphics, "play-feature-1024x500.png"), path.join(lang, "images", "featureGraphic.png"));
  const phone = pick("android").slice(0, 8);
  for (const [index, name] of phone.entries()) {
    await copyFile(path.join(shots, name), path.join(lang, "images", "phoneScreenshots", `${index + 1}_${name}`));
  }
  console.log(`Google Play: text, icon, feature graphic and ${phone.length} screenshots in fastlane/android/`);
}

await write(path.join(out, "version.txt"), version);
// fastlane deliver asks to run its setup wizard (and fails in CI) unless it
// finds a Deliverfile. This one only names the app; the workflow passes the rest.
if (listing.ios) await write(path.join(out, "Deliverfile"), 'app_identifier("com.njarrar.wardrobe")');

// Apple's age rating questions. Wardrobe has none of these, so every answer
// is "none" or "no". A listing can override any of them under ios.age_rating.
const AGE_RATING = {
  alcoholTobaccoOrDrugUseOrReferences: "NONE", contests: "NONE", gamblingSimulated: "NONE",
  gunsOrOtherWeapons: "NONE", horrorOrFearThemes: "NONE", matureOrSuggestiveThemes: "NONE",
  medicalOrTreatmentInformation: "NONE", profanityOrCrudeHumor: "NONE",
  sexualContentGraphicAndNudity: "NONE", sexualContentOrNudity: "NONE",
  violenceCartoonOrFantasy: "NONE", violenceRealistic: "NONE",
  violenceRealisticProlongedGraphicOrSadistic: "NONE",
  advertising: false, ageAssurance: false, gambling: false, healthOrWellnessTopics: false,
  lootBox: false, messagingAndChat: false, parentalControls: false, socialMedia: false,
  unrestrictedWebAccess: false, userGeneratedContent: false,
};
if (listing.ios) {
  await write(path.join(out, "ios", "age-rating.json"), JSON.stringify({ ...AGE_RATING, ...listing.ios.age_rating }, null, 2));
}
