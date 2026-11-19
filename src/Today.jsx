import { useMemo, useState } from "react";
import { ArrowsClockwise, Check, ClockCounterClockwise } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { dayString, forgottenPieces, idleLabel, outfitHarmony, todaysOutfit, COLOR_RULES } from "../shared/style.mjs";
import { wearOutfit, wornOn } from "./wear.js";
import "./today.css";

const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];

function longDate(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// One saved outfit for today, with Wear this and Shuffle. Shuffle runs on the
// device, so it costs nothing.
export function TodayCard({ items, outfits, plan, weather, onWorn, onOpenOutfit }) {
  const today = dayString();
  const [shuffle, setShuffle] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const pick = useMemo(() => todaysOutfit({ outfits, items, plan, today, shuffle, weather }), [outfits, items, plan, today, shuffle, weather]);
  if (!pick) return null;
  const { outfit } = pick;
  const pieces = outfit.garmentIds.map((id) => itemsById.get(id)).filter(Boolean)
    .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  const worn = wornOn(outfit, today);
  const harmony = outfitHarmony(outfit, itemsById);

  const toggleWorn = async () => {
    setBusy(true); setError("");
    try { onWorn(await wearOutfit(outfit, { day: today, undo: worn })); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="today-card glass-card" aria-label="Today's outfit">
      <p className="today-card__eyebrow">
        Today · {longDate(today)}
        {weather && Number.isFinite(weather.temperature) && <> · {Math.round(weather.temperature)}°C {weather.label || ""}</>}
        {pick.planned && <> · planned</>}
      </p>
      <button type="button" className="today-card__title" onClick={() => onOpenOutfit?.(outfit.id)}>
        {outfit.name || "Today's outfit"}
        <span className="harmony-badge">{COLOR_RULES[harmony.rule]?.label} · {harmony.score}</span>
      </button>
      <div className="today-card__pieces">
        {pieces.map((piece) => (
          <span className="today-card__piece" key={piece.id}><img src={assetUrl(piece.thumbnail || piece.image)} alt={piece.name || ""} /></span>
        ))}
      </div>
      <div className="today-card__actions">
        <button type="button" className={worn ? "secondary-button" : "primary-button"} onClick={toggleWorn} disabled={busy}>
          {worn ? <><ClockCounterClockwise size={15} aria-hidden="true" /> Undo, not worn</> : <><Check size={15} weight="bold" aria-hidden="true" /> Wear this</>}
        </button>
        <button type="button" className="secondary-button" onClick={() => setShuffle((value) => value + 1)} disabled={busy || worn}>
          <ArrowsClockwise size={15} aria-hidden="true" /> Shuffle
        </button>
      </div>
      {error && <p className="status error">{error}</p>}
    </section>
  );
}

// Pieces that have sat in the closet for 60 days or more.
export function ForgottenRow({ items, onOpen }) {
  const today = dayString();
  const [all, setAll] = useState(false);
  const forgotten = useMemo(() => forgottenPieces(items, { today }), [items, today]);
  if (!forgotten.length) return null;
  const shown = all ? forgotten : forgotten.slice(0, 8);
  return (
    <section className="forgotten" aria-labelledby="forgotten-title">
      <div className="forgotten__head">
        <h2 id="forgotten-title">Not worn in a while</h2>
        {forgotten.length > 8 && <button type="button" onClick={() => setAll((value) => !value)}>{all ? "Show less" : `See all ${forgotten.length}`}</button>}
      </div>
      <div className={`forgotten__list${all ? " is-open" : ""}`}>
        {shown.map((item) => (
          <button type="button" className="forgotten__item" key={item.id} onClick={() => onOpen(item.id)}>
            <span className="forgotten__media"><img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" /></span>
            <span className="forgotten__name">{item.name}</span>
            <span className="forgotten__when">{idleLabel(item, today)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
