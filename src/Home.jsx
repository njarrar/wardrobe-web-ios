import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, ArrowsLeftRight, CalendarBlank, Camera, Check, ClockCounterClockwise, Heart, ShieldCheck, ThumbsDown, X } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { addDays, daysBetween, lastWorn, OCCASIONS } from "../shared/style.mjs";
import { canMakeOutfit, isOnePiece, makeOutfit, outfitKey, outfitTitle, REST_DAYS, swapCandidates } from "../shared/make-outfit.mjs";
import { FlatLay } from "./FlatLay.jsx";
import { patchOutfit, sendJson, wearOutfit, wornOn } from "./wear.js";
import { formatDay, t } from "./i18n.js";
import { pieceLabel, useToday } from "./color-utils.js";
import { tap, updateWidget } from "./native.js";
import "./home.css";

// The Home tab: one outfit for today (or any day tapped in the week strip),
// laid out in an anatomical flat-lay. The phone makes mixes with no AI, so
// Shuffle and single-piece Swap cost nothing and work offline.

const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];
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

function usablePlanned(outfit, itemsById) {
  if (!outfit) return false;
  const present = (outfit.garmentIds || []).map((id) => itemsById.get(id)).filter(Boolean);
  return present.length >= 2 || (present.length === 1 && isOnePiece(present[0]));
}

function WeekStrip({ today, activeDay, plan, forecast, onSelectDay, onGoToPlan }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  return (
    <section className="week-strip-wrap" aria-label={t("This week")}>
      <div className="week-strip__head">
        <span>{t("This week")}</span>
        <button type="button" className="week-strip__calendar" onClick={() => onGoToPlan(activeDay)}>
          <CalendarBlank size={14} aria-hidden="true" /> {t("View full calendar")}
        </button>
      </div>
      <div className="week-strip" role="group" aria-label={t("This week")}>
        {days.map((day) => {
          const weather = forecast?.[day];
          const selected = day === activeDay;
          return (
            <button
              type="button"
              key={day}
              className={`week-strip__day${day === today ? " is-today" : ""}${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelectDay(day)}
              aria-label={formatDay(day, { weekday: "long", day: "numeric", month: "long" })}
            >
              <span className="week-strip__name">{formatDay(day, { weekday: "narrow" })}</span>
              <span className="week-strip__date">{Number(day.slice(8))}</span>
              <span className="week-strip__temp">{weather && Number.isFinite(weather.temperature) ? <bdi>{`${Math.round(weather.temperature)}°`}</bdi> : ""}</span>
              <span className={`week-strip__dot${plan?.days?.[day] ? " is-planned" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function HomeView({
  items,
  outfits,
  setOutfits,
  plan,
  weather,
  onWorn,
  onOpenPiece,
  onGoToPlan,
  onGoToFavorites,
  initialLockId = null,
  onConsumeInitialLock = null,
}) {
  const today = useToday();
  const lastDayRef = useRef(today);
  const [activeDay, setActiveDay] = useState(today);
  const [state, setState] = useState(() => {
    const saved = read(HOME_KEY, null);
    return saved?.day === today ? { seed: Number(saved.seed) || 0, locked: Array.isArray(saved.locked) ? saved.locked : [] } : { seed: 0, locked: [] };
  });
  const [rejected, setRejected] = useState(notMeKeys);
  const [swappingId, setSwappingId] = useState(null);
  const [customIds, setCustomIds] = useState(null);
  const [undoNotMe, setUndoNotMe] = useState(null);
  const undoTimerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // At midnight start a fresh day instead of carrying yesterday's shuffles over.
  useEffect(() => {
    if (lastDayRef.current === today) return;
    const yesterday = lastDayRef.current;
    lastDayRef.current = today;
    setState({ seed: 0, locked: [] });
    setCustomIds(null);
    setSwappingId(null);
    setActiveDay((current) => (current < today || current === yesterday ? today : current));
  }, [today]);

  useEffect(() => { write(HOME_KEY, { day: today, ...state }); }, [today, state]);
  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  // Jumping from a piece page ("Style with this") locks that piece on Today.
  useEffect(() => {
    if (!initialLockId) return;
    setActiveDay(today);
    setCustomIds(null);
    setSwappingId(null);
    setState({ seed: 0, locked: [initialLockId] });
    onConsumeInitialLock?.();
  }, [initialLockId, today, onConsumeInitialLock]);

  const isToday = activeDay === today;
  const occasion = plan?.occasions?.[activeDay] || "";
  const dayWeather = isToday ? weather?.today : weather?.forecast?.[activeDay] || null;
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const saved = outfits || [];
  const outfitsLoading = outfits === null;
  const favoriteCount = useMemo(() => saved.filter((outfit) => outfit.favorite).length, [saved]);
  const wornOutfit = isToday ? saved.find((outfit) => wornOn(outfit, today) && (outfit.garmentIds || []).some((id) => itemsById.has(id))) : null;
  const plannedForDay = saved.find((outfit) => outfit.id === plan?.days?.[activeDay] && usablePlanned(outfit, itemsById));
  const planned = (!isToday || (!state.seed && !state.locked.length && !customIds)) ? plannedForDay : null;
  const made = useMemo(
    () => (outfitsLoading || wornOutfit || planned || customIds ? null : makeOutfit({
      items,
      today: activeDay,
      weather: dayWeather,
      locked: isToday ? state.locked : [],
      rejected,
      seed: isToday ? state.seed : 0,
      dress: OCCASIONS[occasion]?.dress || "",
      rest: plan?.settings?.pieceRest,
    })),
    [outfitsLoading, wornOutfit, planned, customIds, items, activeDay, dayWeather, isToday, state, rejected, occasion, plan?.settings?.pieceRest],
  );

  const fixed = wornOutfit || planned;
  const rawPieces = customIds
    ? customIds.map((id) => itemsById.get(id)).filter(Boolean)
    : fixed
      ? fixed.garmentIds.map((id) => itemsById.get(id)).filter(Boolean)
      : made?.pieces || [];
  const pieces = rawPieces.slice().sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  const key = outfitKey(pieces.map((piece) => piece.id));
  const record = (!customIds && fixed) || saved.find((outfit) => outfitKey(outfit.garmentIds || []) === key) || null;
  const why = customIds
    ? [t("Customized with your swap.")]
    : fixed
      ? (fixed.reason ? [fixed.reason] : [])
      : (made?.why || []).map(([text, vars]) => t(text, vars));

  const restWindow = plan?.settings?.pieceRest ?? REST_DAYS;
  const allRested = useMemo(() => {
    if (!pieces.length || !restWindow) return false;
    return pieces.every((piece) => {
      const last = lastWorn(piece);
      return !last || daysBetween(last, activeDay) > restWindow;
    });
  }, [pieces, restWindow, activeDay]);

  const swapPiece = swappingId ? pieces.find((piece) => piece.id === swappingId) || null : null;
  const swapList = useMemo(
    () => (swapPiece ? swapCandidates(swapPiece, pieces, items, { today: activeDay, weather: dayWeather, dress: OCCASIONS[occasion]?.dress || "", rest: restWindow }) : []),
    [swapPiece, pieces, items, activeDay, dayWeather, occasion, restWindow],
  );

  // The Home Screen widget shows this week: what is on screen for today,
  // and the planned or made outfit for each of the next six days.
  useEffect(() => {
    if (!isToday) return;
    const describe = (day, list) => {
      const forecast = day === today ? weather?.today : weather?.forecast?.[day];
      const dayOccasion = plan?.occasions?.[day];
      const line = [dayOccasion && t(OCCASIONS[dayOccasion].label), forecast && Number.isFinite(forecast.temperature) && `${Math.round(forecast.temperature)}°C`].filter(Boolean).join(" · ");
      return { day, title: outfitTitle(list), line, pieces: list.slice(0, 4).map((piece) => ({ id: piece.id, url: assetUrl(piece.thumbnail || piece.image) })) };
    };
    const days = [];
    if (pieces.length) days.push(describe(today, pieces));
    for (let index = 1; index < 7; index += 1) {
      const day = addDays(today, index);
      const set = saved.find((outfit) => outfit.id === plan?.days?.[day] && usablePlanned(outfit, itemsById));
      const list = set
        ? set.garmentIds.map((id) => itemsById.get(id)).filter(Boolean)
        : makeOutfit({ items, today: day, weather: weather?.forecast?.[day] || null, rejected, dress: OCCASIONS[plan?.occasions?.[day]]?.dress || "", rest: plan?.settings?.pieceRest })?.pieces || [];
      if (list.length) days.push(describe(day, list.slice().sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part))));
    }
    updateWidget(days, t("Open Wardrobe to see today's outfit"));
    // key stands for the pieces on screen.
  }, [isToday, key, items, outfits, plan, weather, rejected]);

  const run = async (work) => {
    setBusy(true); setError("");
    try { await work(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  const save = async (extra = {}) => {
    if (record) return record;
    const value = await sendJson("/api/import/outfits", "POST", { name: outfitTitle(pieces), reason: why.join(" "), garmentIds: pieces.map((piece) => piece.id), madeOnPhone: true, ...extra }, t("Could not save the outfit."));
    setOutfits((current) => [value.outfit, ...(current || [])]);
    return value.outfit;
  };
  const wear = () => run(async () => {
    const outfit = await save();
    onWorn(await wearOutfit(outfit, { day: today, undo: Boolean(wornOutfit) }));
    tap(wornOutfit ? "light" : "success");
    setCustomIds(null);
    setSwappingId(null);
  });
  const heart = () => run(async () => {
    if (!record) { await save({ favorite: true }); tap(); return; }
    tap();
    const updated = await patchOutfit(record.id, { favorite: !record.favorite });
    setOutfits((current) => (current || []).map((outfit) => (outfit.id === updated.id ? updated : outfit)));
  });
  const shuffle = () => {
    tap();
    setCustomIds(null);
    setSwappingId(null);
    setState((current) => ({ ...current, seed: current.seed + 1 }));
  };
  const notMe = () => {
    const before = { rejected, state };
    const next = [...rejected.filter((entry) => entry !== key), key].slice(-300);
    write(NOT_ME_KEY, next);
    setRejected(next);
    shuffle();
    clearTimeout(undoTimerRef.current);
    setUndoNotMe(before);
    undoTimerRef.current = setTimeout(() => setUndoNotMe(null), 5000);
  };
  const undoNotMeSkip = () => {
    if (!undoNotMe) return;
    clearTimeout(undoTimerRef.current);
    write(NOT_ME_KEY, undoNotMe.rejected);
    setRejected(undoNotMe.rejected);
    setState(undoNotMe.state);
    setUndoNotMe(null);
  };
  const toggleLock = (id) => {
    tap("select");
    setCustomIds(null);
    setState((current) => ({ ...current, locked: current.locked.includes(id) ? current.locked.filter((entry) => entry !== id) : [...current.locked, id] }));
  };
  const applySwap = (replacementId) => {
    if (!swapPiece) return;
    tap("select");
    const nextIds = pieces.map((piece) => (piece.id === swapPiece.id ? replacementId : piece.id));
    setCustomIds(nextIds);
    setSwappingId(null);
  };
  const selectDay = (day) => {
    setActiveDay(day);
    setCustomIds(null);
    setSwappingId(null);
  };

  const hasTemp = Boolean(dayWeather && Number.isFinite(dayWeather.temperature));
  const weatherParts = hasTemp ? [
    dayWeather.label ? t(dayWeather.label) : "",
    dayWeather.wind >= 20 ? t("Wind {n} km/h", { n: dayWeather.wind }) : "",
    dayWeather.rainMm >= 1 ? t("Rain {n} mm", { n: dayWeather.rainMm }) : "",
  ].filter(Boolean) : [];
  const occasionLabel = OCCASIONS[occasion]?.label;
  const canReturnToPlanned = Boolean(isToday && plannedForDay && !wornOutfit && (state.seed > 0 || state.locked.length > 0 || customIds));

  const heading = isToday
    ? (wornOutfit ? t("You wore this today") : planned ? t("Planned for today") : t("Wear this today"))
    : (planned ? t("Planned for {day}", { day: formatDay(activeDay, { weekday: "short", day: "numeric" }) }) : t("Idea for {day}", { day: formatDay(activeDay, { weekday: "short", day: "numeric" }) }));

  return (
    <section className="home" aria-label={t("Today's outfit")}>
      <header className="home__head">
        <div>
          <p className="home__date">{formatDay(activeDay, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h2>{heading}</h2>
        </div>
        <div className="home__head-right">
          {favoriteCount > 0 && onGoToFavorites && (
            <button type="button" className="home__fav-pill" onClick={onGoToFavorites} aria-label={t("Favorites")}>
              <Heart size={13} weight="fill" aria-hidden="true" /> <span>{favoriteCount}</span>
            </button>
          )}
          {(hasTemp || occasionLabel) && (
            <p className="home__weather">
              {occasionLabel && <>{t(occasionLabel)}{hasTemp ? " · " : ""}</>}
              {hasTemp && <><bdi>{`${Math.round(dayWeather.temperature)}°C`}</bdi>{weatherParts.length > 0 ? ` ${weatherParts.join(" · ")}` : ""}</>}
            </p>
          )}
        </div>
      </header>

      {outfitsLoading ? (
        <div className="home__loading" aria-hidden="true">
          <span className="gallery-skeleton" />
        </div>
      ) : !pieces.length ? (
        <div className="home__empty glass-card">
          <p>{canMakeOutfit(items) ? t("No new mix is left for today. Tap Start again to see earlier mixes.") : t("Add a top and a bottom, and your outfit for today shows up here.")}</p>
          {canMakeOutfit(items)
            ? <button type="button" className="secondary-button" onClick={() => { write(NOT_ME_KEY, []); setRejected([]); setCustomIds(null); setState({ seed: 0, locked: [] }); }}><ArrowsClockwise size={15} aria-hidden="true" /> {t("Start again")}</button>
            : <button type="button" className="primary-button" onClick={() => window.dispatchEvent(new Event(ADD_CLOTHES_EVENT))}><Camera size={15} aria-hidden="true" /> {t("Add clothes")}</button>}
        </div>
      ) : (
        <>
          <FlatLay
            pieces={pieces}
            variant="hero"
            lockedIds={isToday ? state.locked : []}
            swappingId={swappingId}
            canLock={isToday && !fixed && !customIds}
            canSwap={isToday && !wornOutfit}
            onOpenPiece={onOpenPiece}
            onToggleLock={toggleLock}
            onStartSwap={(id) => setSwappingId((current) => (current === id ? null : id))}
          />

          {swapPiece && (
            <div className="swap-drawer glass-card" role="region" aria-label={t("Swap {name}", { name: swapPiece.name })}>
              <div className="swap-drawer__head">
                <span><ArrowsLeftRight size={14} aria-hidden="true" /> {t("Swap {name}", { name: swapPiece.name })}</span>
                <button type="button" className="icon-button" onClick={() => setSwappingId(null)} aria-label={t("Close")}>
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              {swapList.length ? (
                <div className="swap-drawer__list">
                  {swapList.slice(0, 10).map((candidate) => (
                    <button type="button" key={candidate.id} onClick={() => applySwap(candidate.id)}>
                      <span><img src={assetUrl(candidate.thumbnail || candidate.image)} alt="" loading="lazy" /></span>
                      <small>{pieceLabel(candidate, t)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="swap-drawer__empty">{t("No other pieces in this category yet.")}</p>
              )}
            </div>
          )}

          <div className="home__meta">
            {allRested && !wornOutfit && (
              <span className="home__badge">
                <ShieldCheck size={14} weight="fill" aria-hidden="true" /> {t("0 repeats in {n} days", { n: restWindow })}
              </span>
            )}
            {why.length > 0 && <p className="home__why">{why.join(" ")}</p>}
          </div>
          {isToday && !fixed && !customIds && state.locked.length > 0 && <p className="home__hint">{t("Locked pieces stay when you shuffle.")}</p>}

          {canReturnToPlanned && (
            <button type="button" className="secondary-button back-to-planned" onClick={() => { setCustomIds(null); setSwappingId(null); setState({ seed: 0, locked: [] }); }}>
              <ArrowCounterClockwise size={14} aria-hidden="true" /> {t("Back to planned")}
            </button>
          )}

          {isToday ? (
            <div className="home__actions">
              <button type="button" className={wornOutfit ? "secondary-button home__wear" : "primary-button home__wear"} onClick={wear} disabled={busy} aria-busy={busy}>
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
          ) : (
            <div className="home__actions">
              <button type="button" className="secondary-button home__wear" onClick={() => selectDay(today)}>
                {t("Back to today")}
              </button>
              <button type="button" className="primary-button" onClick={() => onGoToPlan(activeDay)}>
                <CalendarBlank size={16} aria-hidden="true" /> {t("Edit in Plan")}
              </button>
            </div>
          )}
          {undoNotMe && (
            <div className="toast-undo" role="status">
              <span>{t("Skipped this mix")}</span>
              <button type="button" className="secondary-button" onClick={undoNotMeSkip}>{t("Undo")}</button>
            </div>
          )}
          {error && <p className="status error" role="alert">{error}</p>}
        </>
      )}

      <WeekStrip today={today} activeDay={activeDay} plan={plan} forecast={weather?.forecast} onSelectDay={selectDay} onGoToPlan={onGoToPlan} />
    </section>
  );
}
