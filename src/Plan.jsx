import { useCallback, useEffect, useMemo, useState } from "react";
import { AirplaneTilt, CalendarBlank, CaretLeft, CaretRight, Plus, Trash, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import { sendJson } from "./wear.js";
import {
  COLOR_RULES, DEFAULT_PLAN_SETTINGS, addDays, dayString, outfitHarmony, packingList, parseDay, planDays, planRepeats,
} from "../shared/style.mjs";
import "./plan.css";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];

function monthStart(day) { return `${day.slice(0, 7)}-01`; }
function monthLength(day) { const date = parseDay(monthStart(day)); return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); }
function shiftMonth(day, by) { const date = parseDay(monthStart(day)); date.setMonth(date.getMonth() + by); return dayString(date); }
function monthLabel(day) { return parseDay(day).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function dayLabel(day) { return parseDay(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
function weekStart(day) { return addDays(day, -parseDay(day).getDay()); }

function usePlan() {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiFetch("/api/import/plan", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Could not load your plan."); return response.json(); })
      .then(setPlan)
      .catch((requestError) => { setError(requestError.message); setPlan({ days: {}, settings: DEFAULT_PLAN_SETTINGS, trips: [] }); });
  }, []);
  const save = useCallback(async (next) => {
    setPlan(next);
    try { setPlan(await sendJson("/api/import/plan", "PUT", next, "Could not save your plan.")); setError(""); }
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

function DaySheet({ day, plan, outfits, itemsById, onPick, onClear, onClose }) {
  const current = outfits.find((outfit) => outfit.id === plan.days[day]);
  const recent = new Set(Object.entries(plan.days)
    .filter(([other]) => other !== day && Math.abs((parseDay(other) - parseDay(day)) / 86400000) < plan.settings.restDays)
    .map(([, id]) => id));
  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet plan-sheet" role="dialog" aria-modal="true" aria-label={`Outfit for ${dayLabel(day)}`}>
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">{WEEKDAY_NAMES[parseDay(day).getDay()]}</p>
            <h2>{dayLabel(day)}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close day"><X size={20} aria-hidden="true" /></button>
        </header>
        {current ? (
          <div className="plan-sheet__current">
            <Pieces outfit={current} itemsById={itemsById} size="large" />
            <strong>{current.name}</strong>
            <button type="button" className="secondary-button" onClick={onClear}><Trash size={14} aria-hidden="true" /> Clear this day</button>
          </div>
        ) : <p className="status">Nothing planned yet. Pick an outfit below.</p>}
        <h3 className="plan-sheet__title">Pick an outfit</h3>
        <div className="plan-sheet__list">
          {outfits.map((outfit) => {
            const harmony = outfitHarmony(outfit, itemsById);
            return (
              <button type="button" key={outfit.id} className={outfit.id === current?.id ? "active" : ""} onClick={() => onPick(outfit.id)}>
                <Pieces outfit={outfit} itemsById={itemsById} />
                <span className="plan-sheet__name">{outfit.name}</span>
                <span className="plan-sheet__meta">
                  {COLOR_RULES[harmony.rule]?.label}
                  {recent.has(outfit.id) && <em> · worn nearby</em>}
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
          <p>{dayLabel(trip.from)} to {dayLabel(trip.to)} · {length} {length === 1 ? "day" : "days"} · {planned} planned</p>
        </div>
        <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${trip.name}`}><Trash size={16} aria-hidden="true" /></button>
      </header>
      {planned < length && <button type="button" className="secondary-button" onClick={onPlan}><CalendarBlank size={15} aria-hidden="true" /> Plan the trip days</button>}
      {list.length > 0 && (
        <ul className="packing-list">
          {list.map(({ item, count }) => (
            <li key={item.id}>
              <label>
                <input type="checkbox" checked={packed.includes(item.id)} onChange={() => toggle(item.id)} />
                <img src={assetUrl(item.thumbnail || item.image)} alt="" />
                <span>{item.name}</span>
                <small>{count} {count === 1 ? "day" : "days"}</small>
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
    <form className="trip-form glass-card" onSubmit={(event) => { event.preventDefault(); if (valid) onAdd({ ...trip, id: `${trip.from}-${Date.now().toString(36)}`, name: trip.name.trim() || "Trip" }); }}>
      <label className="field"><span>Where to?</span><input value={trip.name} onChange={(event) => setTrip({ ...trip, name: event.target.value })} placeholder="Cairo" maxLength={60} /></label>
      <div className="trip-form__dates">
        <label className="field"><span>From</span><input type="date" value={trip.from} onChange={(event) => setTrip({ ...trip, from: event.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={trip.to} min={trip.from} onChange={(event) => setTrip({ ...trip, to: event.target.value })} /></label>
      </div>
      <div className="viewer-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!valid}><Plus size={14} weight="bold" aria-hidden="true" /> Add trip</button>
      </div>
    </form>
  );
}

// The Plan tab: a week or month of outfits, filled in one tap, plus trips with
// a packing list.
export function PlanView({ items, outfits, plan, savePlan, planError, forecast = {}, onGoToOutfits }) {
  const today = dayString();
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("wardrobe-plan-mode") || "month"; } catch { return "month"; } });
  const [openDay, setOpenDay] = useState(null);
  const [addingTrip, setAddingTrip] = useState(false);
  const [notice, setNotice] = useState("");
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const outfitsById = useMemo(() => new Map((outfits || []).map((outfit) => [outfit.id, outfit])), [outfits]);
  const usable = useMemo(() => (outfits || []).filter((outfit) => (outfit.garmentIds || []).filter((id) => itemsById.has(id)).length >= 2), [outfits, itemsById]);

  useEffect(() => { try { localStorage.setItem("wardrobe-plan-mode", mode); } catch { /* storage unavailable */ } }, [mode]);
  if (!plan || !outfits) return <p className="status">Loading your plan</p>;

  const settings = plan.settings || DEFAULT_PLAN_SETTINGS;
  const firstDay = mode === "week" ? weekStart(anchor) : monthStart(anchor);
  const length = mode === "week" ? 7 : monthLength(anchor);
  const start = firstDay < today ? today : firstDay;
  const end = addDays(firstDay, length - 1);
  const repeats = new Set(planRepeats(plan.days, settings.restDays));

  const fill = (from, count, replace) => {
    if (!usable.length) { setNotice("Save or style a few outfits first, then plan."); return; }
    const keep = replace ? Object.fromEntries(Object.entries(plan.days).filter(([day]) => day < from)) : plan.days;
    const days = planDays({ outfits: usable, items, start: from, length: count, settings, keep, forecast });
    // Days before `from` stay in the history so the rest rule still sees them.
    savePlan({ ...plan, days: { ...plan.days, ...days } });
    const short = usable.length < settings.restDays;
    setNotice(short ? `You have ${usable.length} outfits, so some come back inside ${settings.restDays} days. Style more to spread them out.` : `Planned ${count} ${count === 1 ? "day" : "days"} with no outfit back inside ${settings.restDays} days.`);
  };

  const planShown = (replace = false) => {
    const from = start;
    const count = Math.round((parseDay(end) - parseDay(from)) / 86400000) + 1;
    if (count > 0) fill(from, count, replace);
  };

  const setSettings = (changes) => savePlan({ ...plan, settings: { ...settings, ...changes } });
  const toggleWorkDay = (day) => setSettings({ workDays: settings.workDays.includes(day) ? settings.workDays.filter((entry) => entry !== day) : [...settings.workDays, day].sort() });
  const pickDay = (day, id) => { savePlan({ ...plan, days: { ...plan.days, [day]: id } }); setOpenDay(null); };
  const clearDay = (day) => { const days = { ...plan.days }; delete days[day]; savePlan({ ...plan, days }); setOpenDay(null); };
  const addTrip = (trip) => { savePlan({ ...plan, trips: [...(plan.trips || []), trip] }); setAddingTrip(false); };
  const removeTrip = (id) => savePlan({ ...plan, trips: (plan.trips || []).filter((trip) => trip.id !== id) });
  const planTrip = (trip) => fill(trip.from < today ? today : trip.from, Math.round((parseDay(trip.to) - parseDay(trip.from < today ? today : trip.from)) / 86400000) + 1, false);

  const leadBlanks = mode === "month" ? parseDay(firstDay).getDay() : 0;
  const cells = [...Array.from({ length: leadBlanks }, () => null), ...Array.from({ length }, (_, index) => addDays(firstDay, index))];
  const tripDays = new Set((plan.trips || []).flatMap((trip) => {
    const list = []; for (let day = trip.from; day <= trip.to; day = addDays(day, 1)) list.push(day); return list;
  }));
  const plannedCount = cells.filter((day) => day && plan.days[day]).length;
  const label = mode === "week" ? `Week of ${dayLabel(firstDay)}` : monthLabel(firstDay);

  return (
    <div className="plan-view">
      <section className="plan-hero glass-card">
        <div className="plan-hero__top">
          <div className="plan-nav">
            <button type="button" className="icon-button" onClick={() => setAnchor(mode === "week" ? addDays(firstDay, -7) : shiftMonth(anchor, -1))} aria-label="Earlier"><CaretLeft size={18} aria-hidden="true" /></button>
            <h2>{label}</h2>
            <button type="button" className="icon-button" onClick={() => setAnchor(mode === "week" ? addDays(firstDay, 7) : shiftMonth(anchor, 1))} aria-label="Later"><CaretRight size={18} aria-hidden="true" /></button>
          </div>
          <div className="plan-mode" role="tablist" aria-label="Plan view">
            {["week", "month"].map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setAnchor(today); }}>
                {value === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>
        <p className="plan-hero__rules">
          Work days {settings.workDays.length ? settings.workDays.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join(", ") : "none"} · No repeat inside {settings.restDays} days{settings.mixForgotten ? " · Mixes in forgotten pieces" : ""}
        </p>
        <button type="button" className="primary-button plan-hero__go" onClick={() => planShown(false)} disabled={end < today}>
          <CalendarBlank size={16} aria-hidden="true" /> {plannedCount ? `Fill the empty days` : mode === "week" ? "Plan the whole week" : "Plan the whole month"}
        </button>
        {plannedCount > 0 && end >= today && <button type="button" className="plan-hero__again" onClick={() => planShown(true)}>Start over from today</button>}
        <p className="plan-hero__hint">One tap. Change any day after.</p>
        {notice && <p className="plan-hero__notice" role="status">{notice}</p>}
        {planError && <p className="status error">{planError}</p>}
        {!usable.length && <p className="plan-hero__notice">You need saved outfits to plan. <button type="button" onClick={onGoToOutfits}>Go to Outfits</button></p>}
      </section>

      <details className="plan-settings">
        <summary>Plan rules</summary>
        <div className="plan-settings__body">
          <span>Work days</span>
          <div className="plan-weekdays">
            {WEEKDAYS.map((letter, day) => (
              <button key={day} type="button" className={settings.workDays.includes(day) ? "active" : ""} aria-pressed={settings.workDays.includes(day)} aria-label={WEEKDAY_NAMES[day]} onClick={() => toggleWorkDay(day)}>{letter}</button>
            ))}
          </div>
          <label className="field">
            <span>Don't repeat an outfit inside</span>
            <select value={settings.restDays} onChange={(event) => setSettings({ restDays: Number(event.target.value) })}>
              {[3, 5, 7, 10, 14, 21].map((value) => <option key={value} value={value}>{value} days</option>)}
            </select>
          </label>
          <label className="plan-settings__check">
            <input type="checkbox" checked={settings.mixForgotten !== false} onChange={(event) => setSettings({ mixForgotten: event.target.checked })} />
            Mix in pieces I haven't worn lately
          </label>
        </div>
      </details>

      {mode === "month" && <div className="plan-grid plan-grid--head" aria-hidden="true">{WEEKDAYS.map((letter, index) => <span key={index}>{letter}</span>)}</div>}
      <div className={`plan-grid plan-grid--${mode}`}>
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} className="plan-day is-blank" aria-hidden="true" />;
          const outfit = outfitsById.get(plan.days[day]);
          const classes = ["plan-day", "glass-card", day === today && "is-today", day < today && "is-past", repeats.has(day) && "is-repeat", tripDays.has(day) && "is-trip"].filter(Boolean).join(" ");
          return (
            <button type="button" key={day} className={classes} onClick={() => setOpenDay(day)} aria-label={`${dayLabel(day)}: ${outfit ? outfit.name : "nothing planned"}`}>
              <span className="plan-day__date">{mode === "week" ? dayLabel(day) : Number(day.slice(8))}</span>
              {outfit ? <Pieces outfit={outfit} itemsById={itemsById} size={mode === "week" ? "large" : "small"} /> : <span className="plan-day__empty">+</span>}
              {mode === "week" && outfit && <span className="plan-day__name">{outfit.name}</span>}
            </button>
          );
        })}
      </div>
      {repeats.size > 0 && <p className="status">Days with a red mark repeat an outfit inside {settings.restDays} days.</p>}

      <section className="plan-trips">
        <div className="forgotten__head">
          <h2>Trips</h2>
          {!addingTrip && <button type="button" onClick={() => setAddingTrip(true)}><Plus size={13} aria-hidden="true" /> Add a trip</button>}
        </div>
        {addingTrip && <TripForm onAdd={addTrip} onCancel={() => setAddingTrip(false)} />}
        {!addingTrip && !(plan.trips || []).length && <p className="status plan-trips__empty">Add a trip to get a packing list from your plan.</p>}
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
          onPick={(id) => pickDay(openDay, id)}
          onClear={() => clearDay(openDay)}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}
