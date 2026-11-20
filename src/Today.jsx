import { useMemo, useState } from "react";
import { assetUrl } from "./api.js";
import { forgottenPieces, idleLabel } from "../shared/style.mjs";
import "./today.css";
import { locale, t } from "./i18n.js";
import { pieceLabel, useToday } from "./color-utils.js";

// Pieces that have sat in the closet for 60 days or more.
export function ForgottenRow({ items, onOpen }) {
  const today = useToday();
  const [all, setAll] = useState(false);
  const forgotten = useMemo(() => forgottenPieces(items, { today }), [items, today]);
  if (!forgotten.length) return null;
  const shown = all ? forgotten : forgotten.slice(0, 8);
  return (
    <section className="forgotten" aria-labelledby="forgotten-title">
      <div className="forgotten__head">
        <h2 id="forgotten-title">{t("Not worn in a while")}</h2>
        {forgotten.length > 8 && (
          <button type="button" onClick={() => setAll((value) => !value)}>
            {all ? t("Show less") : t("See all {n}", { n: forgotten.length })}
          </button>
        )}
      </div>
      <div className={`forgotten__list${all ? " is-open" : ""}`}>
        {shown.map((item) => (
          <button type="button" className="forgotten__item" key={item.id} onClick={() => onOpen(item.id)}>
            <span className="forgotten__media"><img src={assetUrl(item.thumbnail || item.image)} alt="" decoding="async" /></span>
            <span className="forgotten__name">{pieceLabel(item, t)}</span>
            <span className="forgotten__when">{idleLabel(item, today, t, locale())}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
