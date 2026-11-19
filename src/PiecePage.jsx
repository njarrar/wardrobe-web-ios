import { useMemo } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { goesWith, humanColorName, pairingNote, PATTERN_LABELS } from "../shared/pairing.mjs";
import { formatMoney } from "../shared/style.mjs";
import { t } from "./i18n.js";

// The read side of a piece's page: bento attribute tiles (with visual warmth
// dots and human color names), pairing guidance, compatible closet pieces, and
// a one-tap "Style with this" jump. Editing sits behind the Edit button.

const WARMTH = ["Very light", "Light", "Medium", "Warm", "Very warm"];
const DRESS = { casual: "Casual", smart: "Smart", formal: "Formal" };
const SEASONS = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };

// Values that are words (a color name, say) are shown in the app's language.
export function say([text, vars]) {
  return t(text, vars && Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, typeof value === "string" ? t(value) : value])));
}

function WarmthDots({ level }) {
  return (
    <span className="warmth-dots" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={step <= level ? "is-on" : ""} />
      ))}
    </span>
  );
}

export function PieceRead({ item, items, category, onOpen, onStyleWith = null }) {
  const notes = useMemo(() => pairingNote(item), [item]);
  const partners = useMemo(() => goesWith(item, items), [item, items]);
  const colorLabel = item.color ? t(humanColorName(item.color)) : "";
  const facts = [
    { key: "category", label: t("Category"), value: category },
    item.color && {
      key: "color",
      label: t("Color"),
      value: (
        <span className="bento-color">
          <span className="bento-color__dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span>{colorLabel}</span>
        </span>
      ),
    },
    item.kind && { key: "kind", label: t("Kind"), value: item.kind },
    item.pattern && { key: "pattern", label: t("Pattern"), value: t(PATTERN_LABELS[item.pattern] || "") },
    item.warmth && {
      key: "warmth",
      label: t("Warmth"),
      value: (
        <span className="bento-warmth">
          <WarmthDots level={item.warmth} />
          <small>{t(WARMTH[item.warmth - 1] || "")}</small>
        </span>
      ),
    },
    item.formality && { key: "formality", label: t("Dress level"), value: t(DRESS[item.formality] || "") },
    item.seasons?.length > 0 && {
      key: "seasons",
      label: t("Seasons"),
      value: item.seasons.length === 4 ? t("All year") : item.seasons.map((season) => t(SEASONS[season] || season)).join(", "),
    },
    item.price > 0 && { key: "price", label: t("Price paid"), value: formatMoney(Number(item.price)) },
  ].filter(Boolean);

  return (
    <div className="piece-read">
      <div className="piece-read__colors" aria-label={t("Colors")}>
        {[item.color, item.secondaryColor].filter(Boolean).map((color) => <span key={color} style={{ backgroundColor: color }} title={color} />)}
        {(item.tags || []).map((tag) => <em key={tag}>{tag}</em>)}
      </div>

      {notes.length > 0 && (
        <section className="piece-read__note" aria-label={t("How to wear it")}>
          <h3><Sparkle size={14} weight="fill" aria-hidden="true" /> {t("How to wear it")}</h3>
          {notes.map((note) => <p key={note[0]}>{say(note)}</p>)}
        </section>
      )}

      <dl className="piece-read__facts">
        {facts.map(({ key, label, value }) => (
          <div key={key} className="piece-read__tile">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {onStyleWith && (
        <button type="button" className="secondary-button piece-read__style" onClick={() => onStyleWith(item.id)}>
          <Sparkle size={15} aria-hidden="true" /> {t("Style with this")}
        </button>
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
    </div>
  );
}
