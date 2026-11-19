import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Camera, Check, ClockCounterClockwise, Heart, Lock, LockOpen, ThumbsDown } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { addDays, dayString, OCCASIONS } from "../shared/style.mjs";
import { canMakeOutfit, makeOutfit, outfitKey, outfitTitle } from "../shared/make-outfit.mjs";
import { patchOutfit, sendJson, wearOutfit, wornOn } from "./wear.js";
import { formatDay, t } from "./i18n.js";
import "./home.css";

// The Home tab: one outfit for today, laid out flat. The phone makes it from
// the closet with no AI, so Shuffle costs nothing and works offline.

const PART_ORDER = ["upperbody", "lowerbody", "wholebody_up", "shoes", "accessories_up"];
const HOME_KEY = "wardrobe-home";
const NOT_ME_KEY = "wardrobe-not-me";
export const ADD_CLOTHES_EVENT = "wardrobe:add-clothes";

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// Mixes the person said no to, newest last. Shared with the Outfits tab.
export function notMeKeys() {
  const list = read(NOT_ME_KEY, []);
  return Array.isArray(list) ? list.filter((key) => typeof key === "string") : [];
}

function WeekStrip({ today, plan, forecast, onGoToPlan }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  return (
    <div className="week-strip" role="group" aria-label={t("This week")}>
      {days.map((day) => {
        const weather = forecast?.[day];
        return (
          <button type="button" key={day} className={`week-strip__day${day === today ? " is-today" : ""}`} onClick={onGoToPlan} aria-label={formatDay(day, { weekday: "long", day: "numeric", month: "long" })}>
            <span className="week-strip__name">{formatDay(day, { weekday: "narrow" })}</span>
            <span className="week-strip__date">{Number(day.slice(8))}</span>
            <span className="week-strip__temp">{weather && Number.isFinite(weather.temperature) ? `${Math.round(weather.temperature)}°` : ""}</span>
            <span className={`week-strip__dot${plan?.days?.[day] ? " is-planned" : ""}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function HomeView({ items, outfits, setOutfits, plan, weather, onWorn, onOpenPiece, onGoToPlan }) {
  const today = dayString();
  const [state, setState] = useState(() => {
    const saved = read(HOME_KEY, null);
    return saved?.day === today ? { seed: Number(saved.seed) || 0, locked: Array.isArray(saved.locked) ? saved.locked : [] } : { seed: 0, locked: [] };
  });
  const [rejected, setRejected] = useState(notMeKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { write(HOME_KEY, { day: today, ...state }); }, [today, state]);

  const occasion = plan?.occasions?.[today] || "";
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const saved = outfits || [];
  const wornOutfit = saved.find((outfit) => wornOn(outfit, today) && (outfit.garmentIds || []).some((id) => itemsById.has(id)));
  const planned = !state.seed && !state.locked.length ? saved.find((outfit) => outfit.id === plan?.days?.[today] && (outfit.garmentIds || []).every((id) => itemsById.has(id))) : null;
  const made = useMemo(
    () => (wornOutfit || planned ? null : makeOutfit({ items, today, weather: weather?.today, locked: state.locked, rejected, seed: state.seed, dress: OCCASIONS[occasion]?.dress || "", rest: plan?.settings?.pieceRest })),
    [wornOutfit, planned, items, today, weather?.today, state, rejected, occasion, plan?.settings?.pieceRest],
  );

  const fixed = wornOutfit || planned;
  const pieces = (fixed ? fixed.garmentIds.map((id) => itemsById.get(id)).filter(Boolean) : made?.pieces || [])
    .slice().sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  const key = outfitKey(pieces.map((piece) => piece.id));
  const record = fixed || saved.find((outfit) => outfitKey(outfit.garmentIds || []) === key) || null;
  const why = fixed ? (fixed.reason ? [fixed.reason] : []) : (made?.why || []).map(([text, vars]) => t(text, vars));

  const run = async (work) => {
    setBusy(true); setError("");
    try { await work(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  const save = async (extra = {}) => {
    if (record) return record;
    const value = await sendJson("/api/import/outfits", "POST", { name: outfitTitle(pieces), reason: why.join(" "), garmentIds: pieces.map((piece) => piece.id), madeOnPhone: true, ...extra }, "Could not save the outfit.");
    setOutfits((current) => [value.outfit, ...(current || [])]);
    return value.outfit;
  };
  const wear = () => run(async () => {
    const outfit = await save();
    onWorn(await wearOutfit(outfit, { day: today, undo: Boolean(wornOutfit) }));
  });
  const heart = () => run(async () => {
    if (!record) { await save({ favorite: true }); return; }
    const updated = await patchOutfit(record.id, { favorite: !record.favorite });
    setOutfits((current) => (current || []).map((outfit) => (outfit.id === updated.id ? updated : outfit)));
  });
  const shuffle = () => setState((current) => ({ ...current, seed: current.seed + 1 }));
  const notMe = () => {
    const next = [...rejected.filter((entry) => entry !== key), key].slice(-300);
    write(NOT_ME_KEY, next);
    setRejected(next);
    shuffle();
  };
  const toggleLock = (id) => setState((current) => ({ ...current, locked: current.locked.includes(id) ? current.locked.filter((entry) => entry !== id) : [...current.locked, id] }));

  const now = weather?.today;
  const temperature = now && Number.isFinite(now.temperature) ? [
    `${Math.round(now.temperature)}°C ${t(now.label || "")}`.trim(),
    now.wind >= 20 && t("Wind {n} km/h", { n: now.wind }),
    now.rainMm >= 1 && t("Rain {n} mm", { n: now.rainMm }),
  ].filter(Boolean).join(" · ") : "";

  return (
    <section className="home" aria-label={t("Today's outfit")}>
      <header className="home__head">
        <div>
          <p className="home__date">{formatDay(today, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h2>{wornOutfit ? t("You wore this today") : planned ? t("Planned for today") : t("Wear this today")}</h2>
        </div>
        {(temperature || occasion) && <p className="home__weather">{[occasion && t(OCCASIONS[occasion].label), temperature].filter(Boolean).join(" · ")}</p>}
      </header>

      {!pieces.length ? (
        <div className="home__empty glass-card">
          <p>{canMakeOutfit(items) ? t("No new mix is left for today. Shuffle to start again.") : t("Add a top and a bottom, and your outfit for today shows up here.")}</p>
          {canMakeOutfit(items)
            ? <button type="button" className="secondary-button" onClick={() => { write(NOT_ME_KEY, []); setRejected([]); setState({ seed: 0, locked: [] }); }}><ArrowsClockwise size={15} aria-hidden="true" /> {t("Start again")}</button>
            : <button type="button" className="primary-button" onClick={() => window.dispatchEvent(new Event(ADD_CLOTHES_EVENT))}><Camera size={15} aria-hidden="true" /> {t("Add clothes")}</button>}
        </div>
      ) : (
        <>
          <div className={`flat-lay flat-lay--${Math.min(pieces.length, 5)}`}>
            {pieces.map((piece) => {
              const locked = state.locked.includes(piece.id);
              return (
                <div className={`flat-lay__piece flat-lay__piece--${piece.part}${locked ? " is-locked" : ""}`} key={piece.id}>
                  <button type="button" className="flat-lay__open" onClick={() => onOpenPiece(piece.id)} aria-label={piece.name || t("Piece")}>
                    <img src={assetUrl(piece.image || piece.thumbnail)} alt="" />
                  </button>
                  {!fixed && (
                    <button type="button" className="flat-lay__lock" aria-pressed={locked} aria-label={locked ? t("Let {name} change", { name: piece.name }) : t("Keep {name}", { name: piece.name })} onClick={() => toggleLock(piece.id)}>
                      {locked ? <Lock size={15} weight="fill" aria-hidden="true" /> : <LockOpen size={15} aria-hidden="true" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {why.length > 0 && <p className="home__why">{why.join(" ")}</p>}
          {!fixed && state.locked.length > 0 && <p className="home__hint">{t("Locked pieces stay when you shuffle.")}</p>}

          <div className="home__actions">
            <button type="button" className={wornOutfit ? "secondary-button home__wear" : "primary-button home__wear"} onClick={wear} disabled={busy}>
              {wornOutfit ? <><ClockCounterClockwise size={16} aria-hidden="true" /> {t("Undo, not worn")}</> : <><Check size={16} weight="bold" aria-hidden="true" /> {t("Wear this")}</>}
            </button>
            {!wornOutfit && (
              <button type="button" className="secondary-button" onClick={shuffle} disabled={busy}>
                <ArrowsClockwise size={16} aria-hidden="true" /> {t("Shuffle")}
              </button>
            )}
            {!fixed && (
              <button type="button" className="icon-button home__round" onClick={notMe} disabled={busy} aria-label={t("Not me. Do not show this mix again")} title={t("Not me")}>
                <ThumbsDown size={18} aria-hidden="true" />
              </button>
            )}
            <button type="button" className={`icon-button home__round${record?.favorite ? " is-on" : ""}`} onClick={heart} disabled={busy} aria-pressed={Boolean(record?.favorite)} aria-label={record?.favorite ? t("Remove from favorites") : t("Save to favorites")}>
              <Heart size={18} weight={record?.favorite ? "fill" : "regular"} aria-hidden="true" />
            </button>
          </div>
          {error && <p className="status error">{error}</p>}
        </>
      )}

      <WeekStrip today={today} plan={plan} forecast={weather?.forecast} onGoToPlan={onGoToPlan} />
    </section>
  );
}
