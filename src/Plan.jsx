import { useCallback, useEffect, useMemo, useState } from "react";
import { AirplaneTilt, CalendarBlank, CaretLeft, CaretRight, Check, Lock, LockOpen, Plus, Trash, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import { sendJson, wearOutfit } from "./wear.js";
import { CLOSET_CHANGED_EVENT } from "./local/mode.js";
import { isOnePiece } from "../shared/core.mjs";
import {
  COLOR_RULES, DEFAULT_PLAN_SETTINGS, OCCASIONS, OCCASION_IDS, addDays, dayString, occasionFit, outfitHarmony, packingList, parseDay, planDays, planRepeats, wornByDay,
} from "../shared/style.mjs";
import { useSheetDrag } from "./useSheetDrag.js";
import { tap } from "./native.js";
import "./plan.css";
import { formatDay, isRtl, t, tn } from "./i18n.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
// 2026-11-15 is a Sunday, so day 0 to 6 map to Sunday to Saturday.
function weekdayName(day, style = "long") { return formatDay(`2026-11-${15 + day}`, { weekday: style }); }
function weekdayShort(day) { return weekdayName(day, "short"); }
const PART_ORDER = ["upperbody", "lowerbody", "shoes", "wholebody_up", "accessories_up"];

function monthStart(day) { return `${day.slice(0, 7)}-01`; }
function monthLength(day) { const date = parseDay(monthStart(day)); return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); }
function shiftMonth(day, by) { const date = parseDay(monthStart(day)); date.setMonth(date.getMonth() + by); return dayString(date); }
function monthLabel(day) { return formatDay(day, { month: "long", year: "numeric" }); }
function dayLabel(day) { return formatDay(day, { weekday: "short", day: "numeric", month: "short" }); }
function weekStart(day) { return addDays(day, -parseDay(day).getDay()); }

function usePlan() {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const again = () => setReload((count) => count + 1);
    window.addEventListener(CLOSET_CHANGED_EVENT, again);
    return () => window.removeEventListener(CLOSET_CHANGED_EVENT, again);
  }, []);
  useEffect(() => {
    apiFetch("/api/import/plan", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(t("Could not load your plan.")); return response.json(); })
      .then(setPlan)
      .catch((requestError) => {
        // A reload that fails keeps the plan on screen.
        if (reload) return;
        setError(requestError.message); setPlan({ days: {}, lockedDays: [], settings: DEFAULT_PLAN_SETTINGS, trips: [] });
      });
  }, [reload]);
  const save = useCallback(async (next) => {
    setPlan(next);
    try { setPlan(await sendJson("/api/import/plan", "PUT", next, t("Could not save your plan."))); setError(""); }
    catch (requestError) { setError(requestError.message); }
  }, []);
  return { plan, save, error };
}

export { usePlan };

function Pieces({ outfit, itemsById, size = "small" }) {
  const pieces = (outfit?.garmentIds || []).map((id) => itemsById.get(id)).filter(Boolean)
    .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  return (
    <span className={`plan-pieces plan-pieces--${size}`} aria-hidden="true">
      {pieces.slice(0, size === "small" ? 3 : 5).map((piece) => <img key={piece.id} src={assetUrl(piece.thumbnail || piece.image)} alt="" loading="lazy" />)}
    </span>
  );
}

function DaySheet({ day, plan, outfits, itemsById, worn, past, locked, onToggleLock, onPick, onLogPast, onClear, onOccasion, onClose }) {
  const { handleProps, sheetStyle } = useSheetDrag(onClose);
  const [logging, setLogging] = useState(false);
  const current = outfits.find((outfit) => outfit.id === plan.days[day]);
  const occasion = plan.occasions?.[day] || "";
  const wornOutfits = (worn?.outfitIds || []).map((id) => outfits.find((outfit) => outfit.id === id)).filter(Boolean);
  const loosePieces = (worn?.pieceIds || []).filter((id) => !wornOutfits.some((outfit) => outfit.garmentIds.includes(id))).map((id) => itemsById.get(id)).filter(Boolean);
  // Outfits that suit the day's occasion come first.
  const ranked = occasion
    ? outfits.map((outfit, index) => ({ outfit, index, fit: occasionFit(outfit, outfit.garmentIds.map((id) => itemsById.get(id)), occasion) })).sort((a, b) => b.fit - a.fit || a.index - b.index)
    : outfits.map((outfit) => ({ outfit, fit: 0 }));
  const recent = new Set(Object.entries(plan.days)
    .filter(([other]) => other !== day && Math.abs((parseDay(other) - parseDay(day)) / 86400000) < plan.settings.restDays)
    .map(([, id]) => id));

  const logWorn = async (outfit, undo = false) => {
    if (!onLogPast) return;
    setLogging(true);
    try { await onLogPast(outfit, undo); }
    finally { setLogging(false); }
  };

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet plan-sheet" role="dialog" aria-modal="true" aria-label={t("Outfit for {day}", { day: dayLabel(day) })} style={sheetStyle}>
        <span className="sheet-grabber" aria-hidden="true" {...handleProps} />
        <header className="settings-sheet__header" {...handleProps}>
          <div>
            <p className="eyebrow">{weekdayName(parseDay(day).getDay())}</p>
            <h2>{dayLabel(day)}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close day")}><X size={20} aria-hidden="true" /></button>
        </header>
        {(wornOutfits.length > 0 || loosePieces.length > 0) && (
          <div className="plan-sheet__worn">
            <h3 className="plan-sheet__title"><Check size={14} weight="bold" aria-hidden="true" /> {t("You wore")}</h3>
            {wornOutfits.map((outfit) => (
              <div className="plan-sheet__current" key={outfit.id}>
                <Pieces outfit={outfit} itemsById={itemsById} size="large" />
                <strong>{outfit.name}</strong>
                {past && onLogPast && (
                  <button type="button" className="secondary-button" disabled={logging} onClick={() => logWorn(outfit, true)}>
                    <Trash size={14} aria-hidden="true" /> {t("Remove wear log")}
                  </button>
                )}
              </div>
            ))}
            {loosePieces.length > 0 && (
              <div className="plan-sheet__current">
                <Pieces outfit={{ garmentIds: loosePieces.map((piece) => piece.id) }} itemsById={itemsById} size="large" />
                <strong>{loosePieces.map((piece) => piece.name).join(", ")}</strong>
              </div>
            )}
          </div>
        )}
        {past && !wornOutfits.length && !loosePieces.length && !current && <p className="status">{t("Nothing was logged for this day.")}</p>}
        {!past && (
          <div className="plan-occasions" role="group" aria-label={t("What is the day for?")}>
            {OCCASION_IDS.map((id) => (
              <button key={id} type="button" className={occasion === id ? "active" : ""} aria-pressed={occasion === id} onClick={() => onOccasion(occasion === id ? "" : id)}>{t(OCCASIONS[id].label)}</button>
            ))}
          </div>
        )}
        {past ? null : current ? (
          <div className="plan-sheet__current">
            <Pieces outfit={current} itemsById={itemsById} size="large" />
            <strong>{current.name}</strong>
            <div className="plan-sheet__current-actions">
              <button type="button" className={`secondary-button${locked ? " is-locked" : ""}`} aria-pressed={locked} onClick={onToggleLock}>
                {locked ? <><Lock size={14} weight="fill" aria-hidden="true" /> {t("Pinned")}</> : <><LockOpen size={14} aria-hidden="true" /> {t("Pin day")}</>}
              </button>
              <button type="button" className="secondary-button" onClick={onClear}><Trash size={14} aria-hidden="true" /> {t("Clear this day")}</button>
            </div>
          </div>
        ) : <p className="status">{t("Nothing planned yet. Pick an outfit below.")}</p>}
        <h3 className="plan-sheet__title">{past ? t("Log what I wore") : t("Pick an outfit")}</h3>
        <div className="plan-sheet__list">
          {ranked.map(({ outfit, fit }) => {
            const harmony = outfitHarmony(outfit, itemsById);
            const isSelected = past ? wornOutfits.some((entry) => entry.id === outfit.id) : outfit.id === current?.id;
            return (
              <button
                type="button"
                key={outfit.id}
                className={isSelected ? "active" : ""}
                disabled={logging}
                onClick={() => (past ? logWorn(outfit, isSelected) : onPick(outfit.id))}
              >
                <Pieces outfit={outfit} itemsById={itemsById} />
                <span className="plan-sheet__name">{outfit.name}</span>
                <span className="plan-sheet__meta">
                  {t(COLOR_RULES[harmony.rule]?.label || "")}
                  {!past && occasion && fit >= 0.6 && <> · {t("suits {occasion}", { occasion: t(OCCASIONS[occasion].label) })}</>}
                  {!past && recent.has(outfit.id) && <em> · {t("worn nearby")}</em>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TripCard({ trip, plan, outfits, items, onPlan, onRemove }) {
  const list = packingList({ days: plan.days, outfits, items, from: trip.from, to: trip.to });
  const length = Math.round((parseDay(trip.to) - parseDay(trip.from)) / 86400000) + 1;
  const planned = Object.keys(plan.days).filter((day) => day >= trip.from && day <= trip.to).length;
  const [packed, setPacked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`wardrobe-packed-${trip.id}`) || "[]"); } catch { return []; }
  });
  const toggle = (id) => setPacked((current) => {
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    try { localStorage.setItem(`wardrobe-packed-${trip.id}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return (
    <article className="trip-card glass-card">
      <header>
        <div>
          <h3><AirplaneTilt size={16} aria-hidden="true" /> {trip.name}</h3>
          <p>{t("{from} to {to} · {n} days · {p} planned", { from: dayLabel(trip.from), to: dayLabel(trip.to), n: length, p: planned })}</p>
        </div>
        <button type="button" className="icon-button" onClick={onRemove} aria-label={t("Remove {name}", { name: trip.name })}><Trash size={16} aria-hidden="true" /></button>
      </header>
      {planned < length && <button type="button" className="secondary-button" onClick={onPlan}><CalendarBlank size={15} aria-hidden="true" /> {t("Plan the trip days")}</button>}
      {list.length > 0 && (
        <ul className="packing-list">
          {list.map(({ item, count }) => (
            <li key={item.id}>
              <label>
                <input type="checkbox" checked={packed.includes(item.id)} onChange={() => toggle(item.id)} />
                <img src={assetUrl(item.thumbnail || item.image)} alt="" />
                <span>{item.name}</span>
                <small>{tn(count, "{n} day", "{n} days")}</small>
              </label>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function TripForm({ onAdd, onCancel }) {
  const today = dayString();
  const [trip, setTrip] = useState({ name: "", from: addDays(today, 7), to: addDays(today, 10) });
  const valid = trip.from && trip.to && trip.from <= trip.to;
  return (
    <form className="trip-form glass-card" onSubmit={(event) => { event.preventDefault(); if (valid) onAdd({ ...trip, id: `${trip.from}-${Date.now().toString(36)}`, name: trip.name.trim() || t("Trip") }); }}>
      <label className="field"><span>{t("Where to?")}</span><input value={trip.name} onChange={(event) => setTrip({ ...trip, name: event.target.value })} placeholder={t("Cairo")} maxLength={60} /></label>
      <div className="trip-form__dates">
        <label className="field"><span>{t("From")}</span><input type="date" value={trip.from} onChange={(event) => setTrip({ ...trip, from: event.target.value })} /></label>
        <label className="field"><span>{t("To")}</span><input type="date" value={trip.to} min={trip.from} onChange={(event) => setTrip({ ...trip, to: event.target.value })} /></label>
      </div>
      <div className="viewer-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" className="primary-button" disabled={!valid}><Plus size={14} weight="bold" aria-hidden="true" /> {t("Add trip")}</button>
      </div>
    </form>
  );
}

// The Plan tab: a week or month of outfits, filled in one tap, day pinning,
// retroactive past-day wear logging, and trips with a packing list.
export function PlanView({ items, outfits, plan, savePlan, planError, forecast = {}, onGoToOutfits, onWorn = null }) {
  const today = dayString();
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("wardrobe-plan-mode") || "month"; } catch { return "month"; } });
  const [openDay, setOpenDay] = useState(null);
  const [addingTrip, setAddingTrip] = useState(false);
  const [notice, setNotice] = useState("");
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const outfitsById = useMemo(() => new Map((outfits || []).map((outfit) => [outfit.id, outfit])), [outfits]);
  const usable = useMemo(() => (outfits || []).filter((outfit) => {
    const present = (outfit.garmentIds || []).map((id) => itemsById.get(id)).filter(Boolean);
    return present.length >= 2 || (present.length === 1 && isOnePiece(present[0]));
  }), [outfits, itemsById]);
  const worn = useMemo(() => wornByDay(outfits || [], items), [outfits, items]);

  useEffect(() => { try { localStorage.setItem("wardrobe-plan-mode", mode); } catch { /* storage unavailable */ } }, [mode]);
  if (!plan || !outfits) return <p className="status">{t("Loading your plan")}</p>;

  const settings = plan.settings || DEFAULT_PLAN_SETTINGS;
  const lockedSet = new Set(Array.isArray(plan.lockedDays) ? plan.lockedDays : []);
  const firstDay = mode === "week" ? weekStart(anchor) : monthStart(anchor);
  const length = mode === "week" ? 7 : monthLength(anchor);
  const start = firstDay < today ? today : firstDay;
  const end = addDays(firstDay, length - 1);
  const repeats = new Set(planRepeats(plan.days, settings.restDays));

  const fill = (from, count, replace) => {
    if (!usable.length) { setNotice(t("Save or style a few outfits first, then plan.")); return; }
    const keep = replace
      ? Object.fromEntries(Object.entries(plan.days).filter(([day]) => day < from || lockedSet.has(day)))
      : plan.days;
    const days = planDays({ outfits: usable, items, start: from, length: count, settings, keep, forecast, occasions: plan.occasions || {} });
    // Days before `from` stay in the history so the rest rule still sees them.
    savePlan({ ...plan, days: { ...plan.days, ...days } });
    const short = usable.length < settings.restDays;
    setNotice(short ? t("You have {n} outfits, so some come back inside {r} days. Style more to spread them out.", { n: usable.length, r: settings.restDays }) : t("Planned {n} days with no outfit back inside {r} days.", { n: count, r: settings.restDays }));
  };

  const planShown = (replace = false) => {
    const from = start;
    const count = Math.round((parseDay(end) - parseDay(from)) / 86400000) + 1;
    if (count > 0) fill(from, count, replace);
  };

  const setSettings = (changes) => savePlan({ ...plan, settings: { ...settings, ...changes } });
  const toggleWorkDay = (day) => setSettings({ workDays: settings.workDays.includes(day) ? settings.workDays.filter((entry) => entry !== day) : [...settings.workDays, day].sort() });
  const pickDay = (day, id) => { savePlan({ ...plan, days: { ...plan.days, [day]: id } }); setOpenDay(null); };
  const clearDay = (day) => {
    const days = { ...plan.days };
    delete days[day];
    const lockedDays = (plan.lockedDays || []).filter((entry) => entry !== day);
    savePlan({ ...plan, days, lockedDays });
    setOpenDay(null);
  };
  const toggleLockDay = (day) => {
    tap("select");
    const list = Array.isArray(plan.lockedDays) ? plan.lockedDays : [];
    const lockedDays = list.includes(day) ? list.filter((entry) => entry !== day) : [...list, day].sort();
    savePlan({ ...plan, lockedDays });
  };
  const setOccasion = (day, id) => { const occasions = { ...(plan.occasions || {}) }; if (id) occasions[day] = id; else delete occasions[day]; savePlan({ ...plan, occasions }); };
  const addTrip = (trip) => { savePlan({ ...plan, trips: [...(plan.trips || []), trip] }); setAddingTrip(false); };
  const removeTrip = (id) => savePlan({ ...plan, trips: (plan.trips || []).filter((trip) => trip.id !== id) });
  const planTrip = (trip) => fill(trip.from < today ? today : trip.from, Math.round((parseDay(trip.to) - parseDay(trip.from < today ? today : trip.from)) / 86400000) + 1, false);
  const logPast = async (day, outfit, undo) => {
    if (!onWorn) return;
    onWorn(await wearOutfit(outfit, { day, undo }));
    setOpenDay(null);
  };

  const leadBlanks = mode === "month" ? parseDay(firstDay).getDay() : 0;
  const cells = [...Array.from({ length: leadBlanks }, () => null), ...Array.from({ length }, (_, index) => addDays(firstDay, index))];
  const tripDays = new Set((plan.trips || []).flatMap((trip) => {
    const list = []; for (let day = trip.from; day <= trip.to; day = addDays(day, 1)) list.push(day); return list;
  }));
  const plannedCount = cells.filter((day) => day && plan.days[day]).length;
  const label = mode === "week" ? t("Week of {date}", { date: dayLabel(firstDay) }) : monthLabel(firstDay);

  return (
    <div className="plan-view">
      <section className="plan-hero glass-card">
        <div className="plan-hero__top">
          <div className="plan-nav">
            <button type="button" className="icon-button" onClick={() => setAnchor(mode === "week" ? addDays(firstDay, -7) : shiftMonth(anchor, -1))} aria-label={t("Earlier")}><CaretLeft size={18} aria-hidden="true" /></button>
            <h2>{label}</h2>
            <button type="button" className="icon-button" onClick={() => setAnchor(mode === "week" ? addDays(firstDay, 7) : shiftMonth(anchor, 1))} aria-label={t("Later")}><CaretRight size={18} aria-hidden="true" /></button>
          </div>
          <div className="plan-mode" role="tablist" aria-label={t("Plan view")}>
            {["week", "month"].map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setAnchor(today); }}>
                {value === "week" ? t("Week") : t("Month")}
              </button>
            ))}
          </div>
        </div>
        <p className="plan-hero__rules">
          {t("Work days {days} · No repeat inside {n} days", { days: settings.workDays.length ? settings.workDays.map((day) => weekdayShort(day)).join(isRtl() ? "، " : ", ") : t("none"), n: settings.restDays })}{settings.mixForgotten ? t(" · Mixes in forgotten pieces") : ""}
        </p>
        <button type="button" className="primary-button plan-hero__go" onClick={() => planShown(false)} disabled={end < today}>
          <CalendarBlank size={16} aria-hidden="true" /> {plannedCount ? t("Fill the empty days") : mode === "week" ? t("Plan the whole week") : t("Plan the whole month")}
        </button>
        {plannedCount > 0 && end >= today && <button type="button" className="plan-hero__again" onClick={() => planShown(true)}>{t("Start over from today")}</button>}
        <p className="plan-hero__hint">{t("One tap. Change any day after.")}</p>
        {notice && <p className="plan-hero__notice" role="status">{notice}</p>}
        {planError && <p className="status error">{planError}</p>}
        {!usable.length && <p className="plan-hero__notice">{t("You need saved outfits to plan.")} <button type="button" onClick={onGoToOutfits}>{t("Go to Outfits")}</button></p>}
      </section>

      <details className="plan-settings">
        <summary>{t("Plan rules")}</summary>
        <div className="plan-settings__body">
          <span>{t("Work days")}</span>
          <div className="plan-weekdays">
            {WEEKDAYS.map((_, day) => weekdayName(day, "narrow")).map((letter, day) => (
              <button key={day} type="button" className={settings.workDays.includes(day) ? "active" : ""} aria-pressed={settings.workDays.includes(day)} aria-label={weekdayName(day)} onClick={() => toggleWorkDay(day)}>{letter}</button>
            ))}
          </div>
          <label className="field">
            <span>{t("Don't repeat an outfit inside")}</span>
            <select value={settings.restDays} onChange={(event) => setSettings({ restDays: Number(event.target.value) })}>
              {[3, 5, 7, 10, 14, 21].map((value) => <option key={value} value={value}>{tn(value, "{n} day", "{n} days")}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t("Rest a piece after it is worn")}</span>
            <select value={settings.pieceRest ?? 2} onChange={(event) => setSettings({ pieceRest: Number(event.target.value) })}>
              <option value={0}>{t("No rest")}</option>
              {[1, 2, 3, 5, 7].map((value) => <option key={value} value={value}>{tn(value, "{n} day", "{n} days")}</option>)}
            </select>
          </label>
          <label className="plan-settings__check">
            <input type="checkbox" checked={settings.mixForgotten !== false} onChange={(event) => setSettings({ mixForgotten: event.target.checked })} />
            {t("Mix in pieces I haven't worn lately")}
          </label>
        </div>
      </details>

      {mode === "month" && <div className="plan-grid plan-grid--head" aria-hidden="true">{WEEKDAYS.map((_, index) => <span key={index}>{weekdayName(index, "narrow")}</span>)}</div>}
      <div className={`plan-grid plan-grid--${mode}`}>
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} className="plan-day is-blank" aria-hidden="true" />;
          // A past day shows what was worn, not what was planned.
          const wornDay = day <= today ? worn[day] : null;
          const wornOutfit = wornDay?.outfitIds.map((id) => outfitsById.get(id)).find(Boolean);
          const wornPieces = wornDay && !wornOutfit && wornDay.pieceIds.some((id) => itemsById.has(id)) ? { garmentIds: wornDay.pieceIds, name: t("Pieces worn") } : null;
          const wasWorn = Boolean(wornOutfit || wornPieces);
          const outfit = wornOutfit || wornPieces || (day >= today ? outfitsById.get(plan.days[day]) : null);
          const occasion = day >= today ? plan.occasions?.[day] : "";
          const isLocked = day >= today && lockedSet.has(day) && Boolean(plan.days[day]);
          const classes = ["plan-day", "glass-card", day === today && "is-today", day < today && "is-past", wasWorn && "is-worn", isLocked && "is-locked", !wasWorn && repeats.has(day) && "is-repeat", tripDays.has(day) && "is-trip"].filter(Boolean).join(" ");
          return (
            <button type="button" key={day} className={classes} onClick={() => setOpenDay(day)} aria-label={`${dayLabel(day)}: ${wasWorn ? t("worn") + ", " + outfit.name : outfit ? outfit.name : day < today ? t("nothing logged") : t("nothing planned")}${occasion ? ", " + t(OCCASIONS[occasion].label) : ""}`}>
              <span className="plan-day__date">
                {mode === "week" ? dayLabel(day) : Number(day.slice(8))}
                {wasWorn && <Check size={11} weight="bold" className="plan-day__check" aria-hidden="true" />}
                {isLocked && !wasWorn && <Lock size={10} weight="fill" className="plan-day__lock" aria-hidden="true" />}
              </span>
              {outfit ? <Pieces outfit={outfit} itemsById={itemsById} size={mode === "week" ? "large" : "small"} /> : <span className="plan-day__empty">{day < today ? "" : "+"}</span>}
              {occasion && <span className="plan-day__occasion">{mode === "week" ? t(OCCASIONS[occasion].label) : t(OCCASIONS[occasion].label).slice(0, 1)}</span>}
              {mode === "week" && outfit && <span className="plan-day__name">{outfit.name}</span>}
            </button>
          );
        })}
      </div>
      {repeats.size > 0 && <p className="status">{t("Days with a red mark repeat an outfit inside {n} days.", { n: settings.restDays })}</p>}

      <section className="plan-trips">
        <div className="forgotten__head">
          <h2>{t("Trips")}</h2>
          {!addingTrip && <button type="button" onClick={() => setAddingTrip(true)}><Plus size={13} aria-hidden="true" /> {t("Add a trip")}</button>}
        </div>
        {addingTrip && <TripForm onAdd={addTrip} onCancel={() => setAddingTrip(false)} />}
        {!addingTrip && !(plan.trips || []).length && <p className="status plan-trips__empty">{t("Add a trip to get a packing list from your plan.")}</p>}
        {(plan.trips || []).map((trip) => (
          <TripCard key={trip.id} trip={trip} plan={plan} outfits={usable} items={items} onPlan={() => planTrip(trip)} onRemove={() => removeTrip(trip.id)} />
        ))}
      </section>

      {openDay && (
        <DaySheet
          day={openDay}
          plan={{ ...plan, settings }}
          outfits={usable}
          itemsById={itemsById}
          worn={openDay <= today ? worn[openDay] : null}
          past={openDay < today}
          locked={lockedSet.has(openDay)}
          onToggleLock={() => toggleLockDay(openDay)}
          onOccasion={(id) => setOccasion(openDay, id)}
          onPick={(id) => pickDay(openDay, id)}
          onLogPast={onWorn ? (outfit, undo) => logPast(openDay, outfit, undo) : null}
          onClear={() => clearDay(openDay)}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}
