import { useMemo } from "react";
import { assetUrl } from "./api.js";
import { goesWith, pairingNote, PATTERN_LABELS } from "../shared/pairing.mjs";
import { formatMoney } from "../shared/style.mjs";
import { t } from "./i18n.js";

// The read side of a piece's page: what it is, how to wear it and what it
// goes with. Editing sits behind the Edit button.

const WARMTH = ["Very light", "Light", "Medium", "Warm", "Very warm"];
const DRESS = { casual: "Casual", smart: "Smart", formal: "Formal" };
const SEASONS = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };

// Values that are words (a color name, say) are shown in the app's language.
export function say([text, vars]) {
  return t(text, vars && Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, typeof value === "string" ? t(value) : value])));
}

export function PieceRead({ item, items, category, onOpen }) {
  const notes = useMemo(() => pairingNote(item), [item]);
  const partners = useMemo(() => goesWith(item, items), [item, items]);
  const facts = [
    [t("Category"), category],
    item.kind && [t("Kind"), item.kind],
    item.pattern && [t("Pattern"), t(PATTERN_LABELS[item.pattern] || "")],
    item.warmth && [t("Warmth"), t(WARMTH[item.warmth - 1] || "")],
    item.formality && [t("Dress level"), t(DRESS[item.formality] || "")],
    item.seasons?.length > 0 && [t("Seasons"), item.seasons.length === 4 ? t("All year") : item.seasons.map((season) => t(SEASONS[season] || season)).join(", ")],
    item.price > 0 && [t("Price paid"), formatMoney(Number(item.price))],
  ].filter(Boolean);

  return (
    <div className="piece-read">
      <div className="piece-read__colors" aria-label={t("Colors")}>
        {[item.color, item.secondaryColor].filter(Boolean).map((color) => <span key={color} style={{ backgroundColor: color }} title={color} />)}
        {(item.tags || []).map((tag) => <em key={tag}>{tag}</em>)}
      </div>

      {notes.length > 0 && (
        <section className="piece-read__note" aria-label={t("How to wear it")}>
          <h3>{t("How to wear it")}</h3>
          {notes.map((note) => <p key={note[0]}>{say(note)}</p>)}
        </section>
      )}

      {partners.length > 0 && (
        <section className="piece-read__with" aria-label={t("Goes well with")}>
          <h3>{t("Goes well with")}</h3>
          <div className="piece-read__row">
            {partners.map((partner) => (
              <button type="button" key={partner.id} onClick={() => onOpen(partner.id)} aria-label={partner.name || t("Piece")}>
                <span><img src={assetUrl(partner.thumbnail || partner.image)} alt="" loading="lazy" /></span>
                <small>{partner.name}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <dl className="piece-read__facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </div>
  );
}
