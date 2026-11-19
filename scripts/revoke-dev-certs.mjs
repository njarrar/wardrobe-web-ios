// Revokes the account's Apple Development certificates before a release
// build. Each build asks Apple for a new development certificate, and the
// account only holds a few, so old ones must go or the archive step fails
// with "maximum number of certificates". Distribution certificates, which
// sign the store build, are never touched.
//
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (the .p8 file).
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const API = "https://api.appstoreconnect.apple.com/v1";
const TYPES = ["DEVELOPMENT", "IOS_DEVELOPMENT"];
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) { console.error("Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH."); process.exit(1); }

const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = `${part({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })}.${part({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
  const signature = createSign("SHA256").update(head).sign({ key: await readFile(ASC_KEY_PATH, "utf8"), dsaEncoding: "ieee-p1363" });
  return `${head}.${signature.toString("base64url")}`;
}

const headers = { Authorization: `Bearer ${await token()}` };
const list = await fetch(`${API}/certificates?filter[certificateType]=${TYPES.join(",")}&limit=200&fields[certificates]=name,certificateType,expirationDate`, { headers });
if (!list.ok) { console.error(`Could not list certificates: ${list.status} ${await list.text()}`); process.exit(1); }
const certificates = (await list.json()).data || [];
console.log(`${certificates.length} development certificate(s) found.`);
let failed = 0;
for (const certificate of certificates) {
  // Checked again here, so a change to the filter can never reach a distribution certificate.
  if (!TYPES.includes(certificate.attributes?.certificateType)) continue;
  const response = await fetch(`${API}/certificates/${certificate.id}`, { method: "DELETE", headers });
  if (response.ok) console.log(`Revoked ${certificate.attributes.certificateType}, expires ${certificate.attributes.expirationDate}.`);
  else { failed += 1; console.error(`Could not revoke ${certificate.id}: ${response.status}`); }
}
if (failed) process.exit(1);
