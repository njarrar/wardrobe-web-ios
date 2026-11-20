import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsLeftRight, Check, ClockCounterClockwise, CoatHanger, DeviceMobile, Heart, MagicWand, MagnifyingGlass, PencilSimple, Plus, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import { askAiConsent, useAiSetup } from "./ai-setup.js";
import { COLOR_RULES, COLOR_RULE_IDS, dayString, forgottenPieces, lastWorn, outfitHarmony, wearCount } from "../shared/style.mjs";
import { tileNote } from "../shared/pairing.mjs";
import { patchOutfit, sendJson, wearOutfit, wornOn } from "./wear.js";
import { canMakeOutfit, isOnePiece, makeOutfits, outfitTitle, swapCandidates } from "../shared/make-outfit.mjs";
import { FlatLay } from "./FlatLay.jsx";
import { tap } from "./native.js";
import { notMeKeys } from "./Home.jsx";
import "./outfits.css";
import "./today.css";
import { formatDay, t, tn } from "./i18n.js";
import { useDialog } from "./dialog.js";
import { normalizeSearchText, pieceLabel } from "./color-utils.js";

// The Outfits tab: outfits the AI styles, outfits built by hand, an occasion
// filter, anatomical flat-lay cards, and a viewer with single-piece swap.

const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];
const PART_LABELS = {
  wholebody_up: "Jackets",
  upperbody: "Tops",
  lowerbody: "Bottoms",
  shoes: "Shoes",
  accessories_up: "Accessories",
};
const FAVORITES = "\u2665 favorites"; // cannot clash with an occasion tag
const QUICK_PROMPTS = ["Weekend in the city", "Smart casual office", "Dinner out", "Cold and rainy"];

// Common occasion tags show in the app's language; anything else as typed.
const CANONICAL_OCCASIONS = {
  work: "Work",
  office: "Office",
  casual: "Casual",
  "smart casual": "Smart casual",
  weekend: "Weekend",
  dinner: "Dinner",
  formal: "Formal",
  evening: "Evening",
  coffee: "Coffee",
  date: "Date",
  everyday: "Everyday",
  party: "Party",
  travel: "Travel",
  rainy: "Rainy",
  summer: "Summer",
  winter: "Winter",
};
function formatOccasionTag(tag) {
  const key = CANONICAL_OCCASIONS[String(tag || "").trim().toLowerCase()];
  return key ? t(key) : tag;
}

function outfitPieces(outfit, itemsById) {
  return (outfit.garmentIds || [])
    .map((id) => itemsById.get(id))
    .filter(Boolean)
    .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
}

// "work, Weekend ،،" -> ["work", "weekend"]. Takes English and Arabic commas.
// The server trims and caps these too.
function splitOccasions(text) {
  return String(text || "").split(/[,،]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function HarmonyBadge({ harmony }) {
  return <span className="harmony-badge" title={t(COLOR_RULES[harmony.rule]?.hint || "")}>{t(COLOR_RULES[harmony.rule]?.label || "")} · {harmony.score}</span>;
}

function StyleForm({ busy, ready, onStyle, onMake, canMake, onCompose, canCompose, forgottenCount }) {
  const [count, setCount] = useState(4);
  const [notes, setNotes] = useState("");
  const [rule, setRule] = useState("");
  const [useForgotten, setUseForgotten] = useState(false);
  return (
    <form className="outfit-style-form" onSubmit={(event) => { event.preventDefault(); onStyle({ count, notes, rule, useForgotten }); }}>
      <fieldset className="style-rules" disabled={busy}>
        <legend>{t("Color rule")}</legend>
        {[["", "Auto"], ...COLOR_RULE_IDS.map((id) => [id, COLOR_RULES[id].label])].map(([id, label]) => (
          <button key={id || "auto"} type="button" className={rule === id ? "active" : ""} aria-pressed={rule === id} title={t(id ? COLOR_RULES[id].hint : "Pick the best rule for each outfit")} onClick={() => setRule(id)}>
            {t(label)}
          </button>
        ))}
      </fieldset>
      <label>
        <span>{t("Outfits")}</span>
        <select id="outfit-count" value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={busy}>
          {[1, 2, 3, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="outfit-style-form__notes">
        <span>{t("Anything in mind?")} <em>{t("optional")}</em></span>
        <input id="outfit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("Weekend in the city, cool weather")} maxLength={500} disabled={busy} />
      </label>
      <button type="submit" disabled={busy || !ready} aria-busy={busy} aria-describedby={ready ? undefined : "outfit-needs-key"}>
        {busy ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <MagicWand size={15} aria-hidden="true" />}
        {busy ? t("Styling") : t("Style new outfits")}
      </button>
      {canMake && (
        <button type="button" className="outfit-make" onClick={() => onMake({ count, rule, useForgotten })} disabled={busy}>
          <DeviceMobile size={15} aria-hidden="true" /> {t("Make on this phone, no AI")}
        </button>
      )}
      {forgottenCount > 0 && (
        <label className="style-forgotten">
          <input type="checkbox" checked={useForgotten} onChange={(event) => setUseForgotten(event.target.checked)} disabled={busy} />
          {t("Use pieces I haven't worn lately ({n})", { n: forgottenCount })}
        </label>
      )}
      {!ready && <p className="outfit-style-form__hint" id="outfit-needs-key">{canMake ? t("The phone can make outfits with no AI. For outfits styled by AI, add an AI key in Settings (the gear at the top).") : t("To style outfits, add an AI key in Settings (the gear at the top). You can still build your own.")}</p>}
      <div className="outfit-style-form__footer">
        <div className="outfit-prompts" aria-label={t("Ideas")}>
          {QUICK_PROMPTS.map((key) => {
            const prompt = t(key);
            return (
              <button
                key={key}
                type="button"
                className={notes === prompt ? "active" : ""}
                aria-pressed={notes === prompt}
                onClick={() => setNotes((current) => (current === prompt ? "" : prompt))}
                disabled={busy}
              >
                {prompt}
              </button>
            );
          })}
        </div>
        {canCompose && (
          <button type="button" className="outfit-compose" onClick={onCompose}>
            <CoatHanger size={15} aria-hidden="true" /> {t("Build your own")}
          </button>
        )}
      </div>
    </form>
  );
}

// Rich horizontal piece rows inside an open outfit, with inline single-piece swap.
function PieceList({ pieces, items, weather, onSelect, onSwap, swappingId, setSwappingId, busy }) {
  const activePiece = swappingId ? pieces.find((item) => item.id === swappingId) || null : null;
  const candidates = useMemo(
    () => (activePiece ? swapCandidates(activePiece, pieces, items, { weather }) : []),
    [activePiece, pieces, items, weather],
  );

  return (
    <div className="outfit-viewer__pieces">
      {pieces.map((item) => {
        const hint = tileNote(item);
        const swapping = swappingId === item.id;
        return (
          <div className={`outfit-piece-row${swapping ? " is-swapping" : ""}`} key={item.id}>
            <button type="button" className="outfit-piece-row__open" onClick={() => onSelect?.(item.id)} disabled={!onSelect}>
              <span className="outfit-piece-row__thumb"><img src={assetUrl(item.thumbnail || item.image)} alt="" /></span>
              <span className="outfit-piece-row__info">
                <strong>{pieceLabel(item, t)}</strong>
                {hint && <small>{t(hint)}</small>}
              </span>
            </button>
            {onSwap && (
              <button
                type="button"
                className={`icon-button outfit-piece-row__swap${swapping ? " is-active" : ""}`}
                aria-pressed={swapping}
                aria-label={t("Swap {name}", { name: pieceLabel(item, t) })}
                title={t("Swap {name}", { name: pieceLabel(item, t) })}
                disabled={busy}
                onClick={() => setSwappingId((current) => (current === item.id ? null : item.id))}
              >
                <ArrowsLeftRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
      {activePiece && onSwap && (
        <div className="outfit-swap-tray" role="region" aria-label={t("Swap {name}", { name: activePiece.name })}>
          <div className="outfit-swap-tray__head">
            <span>{t("Swap {name}", { name: activePiece.name })}</span>
            <button type="button" className="icon-button" onClick={() => setSwappingId(null)} aria-label={t("Close")}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {candidates.length ? (
            <div className="outfit-swap-tray__list">
              {candidates.slice(0, 10).map((candidate) => (
                <button type="button" key={candidate.id} disabled={busy} onClick={() => onSwap(activePiece.id, candidate.id)}>
                  <span><img src={assetUrl(candidate.thumbnail || candidate.image)} alt="" loading="lazy" /></span>
                  <small>{pieceLabel(candidate, t)}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="outfit-swap-tray__empty">{t("No other pieces in this category yet.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function OutfitFields({ draft, setDraft }) {
  const change = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  return (
    <div className="outfit-fields">
      <label className="field">
        <span>{t("Name")}</span>
        <input id="outfit-name" value={draft.name} onChange={change("name")} placeholder={t("Easy Saturday")} maxLength={80} />
      </label>
      <label className="field">
        <span>{t("Occasions, separated by commas")}</span>
        <input id="outfit-occasion" value={draft.occasion} onChange={change("occasion")} placeholder={t("weekend, coffee")} />
      </label>
      <label className="field">
        <span>{t("Note")}</span>
        <input id="outfit-reason" value={draft.reason} onChange={change("reason")} placeholder={t("Why these go together")} maxLength={400} />
      </label>
    </div>
  );
}

// The closet's pieces grouped by part, with a search box once there are many.
function PiecePicker({ items, selectedIds, onToggle }) {
  const [search, setSearch] = useState("");
  const needle = normalizeSearchText(search.trim());
  const groups = useMemo(() => {
    const words = needle ? needle.split(/\s+/).filter(Boolean) : [];
    const filtered = words.length
      ? items.filter((item) => {
        const text = normalizeSearchText([item.name, item.kind, item.kind && t(item.kind), PART_LABELS[item.part], t(PART_LABELS[item.part] || ""), ...(item.tags || [])].filter(Boolean).join(" "));
        return words.every((word) => text.includes(word));
      })
      : items;
    return PART_ORDER
      .map((part) => ({ part, items: filtered.filter((item) => item.part === part) }))
      .filter((group) => group.items.length);
  }, [items, needle]);

  return (
    <div className="builder-picker">
      {items.length > 8 && (
        <label className="builder-search">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Filter pieces")} aria-label={t("Filter pieces")} />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("Clear search")}>
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </label>
      )}
      {!groups.length && <p className="status">{t("No matches")}</p>}
      {groups.map((group) => (
        <fieldset className="outfit-builder__group" key={group.part}>
          <legend>{t(PART_LABELS[group.part] || "")}</legend>
          <div className="outfit-builder__items">
            {group.items.map((item) => {
              const active = selectedIds.includes(item.id);
              return (
                <button key={item.id} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => onToggle(item.id)}>
                  <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
                  <span>{pieceLabel(item, t)}</span>
                  {active && <Check className="outfit-builder__check" size={12} weight="bold" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

// "Build your own": pick two or more pieces (or a one-piece), then save them as an outfit.
function OutfitBuilder({ items, onClose, onCreated }) {
  const [draft, setDraft] = useState({ name: "", occasion: "", reason: "" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useDialog({ open: true, onClose, initialFocusRef: closeRef, containerRef: dialogRef });
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selected = selectedIds.map((id) => itemsById.get(id)).filter(Boolean);
  const canSave = selected.length >= 2 || (selected.length === 1 && isOnePiece(selected[0]));

  const toggle = (id) => setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const submit = async (event) => {
    event.preventDefault();
    if (saving || !canSave) return;
    setSaving(true); setError("");
    try {
      const value = await sendJson("/api/import/outfits", "POST", {
        name: draft.name,
        occasion: splitOccasions(draft.occasion),
        reason: draft.reason,
        garmentIds: selectedIds,
      }, t("Could not save the outfit."));
      onCreated(value.outfit);
    } catch (requestError) { setError(requestError.message); setSaving(false); }
  };

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} className="outfit-viewer outfit-builder" role="dialog" aria-modal="true" aria-label={t("Build an outfit")}>
        <button ref={closeRef} className="viewer-icon-close" type="button" onClick={onClose} aria-label={t("Close")}>
          <X size={24} weight="light" aria-hidden="true" />
        </button>
        <div className="outfit-viewer__photo">
          {selected.length
            ? <FlatLay pieces={selected} variant="detail" />
            : <p className="outfit-builder__empty"><CoatHanger size={32} weight="light" aria-hidden="true" />{t("Pick at least two pieces")}</p>}
        </div>
        <form className="outfit-viewer__details" onSubmit={submit}>
          <h2>{t("Build an outfit")}</h2>
          <OutfitFields draft={draft} setDraft={setDraft} />
          <PiecePicker items={items} selectedIds={selectedIds} onToggle={toggle} />
          {error && <p className="status error" role="alert">{error}</p>}
          <div className="viewer-actions">
            <span className="builder-summary" role="status">
              {canSave ? tn(selected.length, "{n} piece selected", "{n} pieces selected") : t("Pick at least two pieces")}
            </span>
            <span className="action-spacer" />
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
            <button type="submit" className="primary-button" disabled={saving || !canSave} aria-busy={saving}>
              {saving ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <Plus size={15} weight="bold" aria-hidden="true" />} {saving ? t("Saving") : t("Save outfit")}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

export function OutfitGallery({
  items,
  outfits,
  setOutfits,
  loadError = "",
  weather = null,
  onWorn,
  openId,
  setOpenId,
  onSelectGarment,
  initialFilter = null,
  onConsumeFilter = null,
}) {
  const setup = useAiSetup();
  const [error, setError] = useState("");
  const [wearing, setWearing] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swappingId, setSwappingId] = useState(null);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [styling, setStyling] = useState(false);
  const [notice, setNotice] = useState("");
  const [occasion, setOccasion] = useState("all");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const viewerRef = useRef(null);
  const viewerCloseRef = useRef(null);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const forgotten = useMemo(() => forgottenPieces(items), [items]);

  const closeViewer = useCallback(() => { setOpenId(null); setEditing(null); setSwappingId(null); setConfirmingDelete(false); }, [setOpenId]);

  useEffect(() => {
    if (initialFilter === "favorites") {
      setOccasion(FAVORITES);
      onConsumeFilter?.();
    }
  }, [initialFilter, onConsumeFilter]);

  // Escape steps back one level: the delete question, then editing, then the outfit.
  const viewerEscape = useCallback(() => {
    if (confirmingDelete) setConfirmingDelete(false);
    else if (editing) setEditing(null);
    else closeViewer();
  }, [confirmingDelete, editing, closeViewer]);
  const viewerOpen = Boolean(openId && (outfits || []).some((outfit) => outfit.id === openId));
  useDialog({ open: viewerOpen, onClose: viewerEscape, initialFocusRef: viewerCloseRef, containerRef: viewerRef });
  useEffect(() => { setConfirmingDelete(false); }, [openId]);

  const occasions = useMemo(() => {
    const counts = new Map();
    for (const outfit of outfits || []) {
      for (const tag of outfit.occasion || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [outfits]);

  // Drop a filter whose last outfit was deleted or renamed away.
  useEffect(() => {
    if (occasion === FAVORITES ? !(outfits || []).some((outfit) => outfit.favorite) : occasion !== "all" && !occasions.some(([tag]) => tag === occasion)) setOccasion("all");
  }, [occasion, occasions, outfits]);

  const style = async ({ count, notes, rule, useForgotten }) => {
    if (!(await askAiConsent(setup))) return;
    setStyling(true); setError(""); setNotice("");
    try {
      const value = await sendJson("/api/import/outfits/generate", "POST", { count, notes, rule, preferIds: useForgotten ? forgotten.map((item) => item.id) : [] }, t("Could not style outfits."));
      const created = value.outfits || [];
      setOutfits((current) => [...created, ...(current || [])]);
      if (!created.length) setNotice(t("No new combinations found. Add more pieces and try again."));
      else if (created.length < count) setNotice(tn(created.length, "Found {n} new outfit in your wardrobe.", "Found {n} new outfits in your wardrobe."));
    } catch (requestError) { setError(requestError.message); }
    finally { setStyling(false); }
  };

  // Outfits made here on the device: no AI, no cost, works offline. Ones
  // already saved stay, even when a later one fails.
  const make = async ({ count, rule = "", useForgotten = false }) => {
    setStyling(true); setError(""); setNotice("");
    const created = [];
    let failed = false;
    try {
      const made = makeOutfits({ items, outfits: outfits || [], rejected: notMeKeys(), count, weather, rule, preferIds: useForgotten ? forgotten.map((item) => item.id) : [] });
      for (const outfit of made) {
        const value = await sendJson("/api/import/outfits", "POST", { name: outfitTitle(outfit.pieces), reason: outfit.why.map(([text, vars]) => t(text, vars)).join(" "), garmentIds: outfit.garmentIds, madeOnPhone: true }, t("Could not save the outfit."));
        created.push(value.outfit);
      }
    } catch (requestError) { failed = true; setError(requestError.message); }
    finally {
      if (created.length) setOutfits((current) => [...created, ...(current || [])]);
      if (!failed && !created.length) setNotice(t("No new combinations found. Add more pieces and try again."));
      else if (!failed && created.length < count) setNotice(tn(created.length, "Found {n} new outfit in your wardrobe.", "Found {n} new outfits in your wardrobe."));
      setStyling(false);
    }
  };

  const toggleFavorite = async (outfit) => {
    setError("");
    try {
      const updated = await patchOutfit(outfit.id, { favorite: !outfit.favorite });
      setOutfits((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (requestError) { setError(requestError.message); }
  };

  const swapPieceInOutfit = async (outfit, oldId, newId) => {
    setSwapping(true); setError("");
    try {
      const updated = await patchOutfit(outfit.id, { swap: { from: oldId, to: newId } });
      setOutfits((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setSwappingId(null);
      tap("select");
    } catch (requestError) { setError(requestError.message); }
    finally { setSwapping(false); }
  };

  const saveEdit = async (id) => {
    setError("");
    try {
      const updated = await sendJson(`/api/import/outfits/${encodeURIComponent(id)}`, "PATCH", {
        name: editing.name,
        occasion: splitOccasions(editing.occasion),
        reason: editing.reason,
      }, t("Could not save the outfit."));
      setOutfits((current) => current.map((outfit) => (outfit.id === id ? updated : outfit)));
      setEditing(null);
    } catch (requestError) { setError(requestError.message); }
  };

  const remove = async (id) => {
    if (deleting) return;
    setError(""); setDeleting(true);
    try {
      const response = await apiFetch(`/api/import/outfits/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(t("Could not delete the outfit."));
      setOutfits((current) => current.filter((outfit) => outfit.id !== id));
      closeViewer();
    } catch (requestError) { setError(requestError.message); }
    finally { setDeleting(false); }
  };

  const toggleWorn = async (outfit) => {
    setWearing(true); setError("");
    try { onWorn(await wearOutfit(outfit, { day: dayString(), undo: wornOn(outfit) })); }
    catch (requestError) { setError(requestError.message); }
    finally { setWearing(false); }
  };

  if (!outfits) return loadError ? <p className="status error" role="alert">{loadError}</p> : <p className="status">{t("Loading outfits")}</p>;

  const favorites = outfits.filter((outfit) => outfit.favorite);
  const shown = occasion === "all" ? outfits : occasion === FAVORITES ? favorites : outfits.filter((outfit) => (outfit.occasion || []).includes(occasion));
  const open = outfits.find((outfit) => outfit.id === openId);
  const openPieces = open ? outfitPieces(open, itemsById) : [];

  return (
    <>
      <StyleForm busy={styling} ready={Boolean(setup?.ready)} onStyle={style} onMake={make} canMake={canMakeOutfit(items)} canCompose={canMakeOutfit(items) || items.length >= 2} onCompose={() => setBuilding(true)} forgottenCount={forgotten.length} />
      {(occasions.length > 0 || favorites.length > 0) && (
        <nav className="category-nav outfit-occasions" aria-label={t("Filter outfits by occasion")}>
          <button type="button" className={occasion === "all" ? "active" : ""} aria-pressed={occasion === "all"} onClick={() => setOccasion("all")}>
            {t("All")} <span className="chip-count">{outfits.length}</span>
          </button>
          {favorites.length > 0 && (
            <button type="button" className={occasion === FAVORITES ? "active" : ""} aria-pressed={occasion === FAVORITES} onClick={() => setOccasion(occasion === FAVORITES ? "all" : FAVORITES)}>
              <Heart size={13} weight="fill" aria-hidden="true" /> {t("Favorites")} <span className="chip-count">{favorites.length}</span>
            </button>
          )}
          {occasions.map(([tag, count]) => (
            <button key={tag} type="button" className={occasion === tag ? "active" : ""} aria-pressed={occasion === tag} onClick={() => setOccasion(occasion === tag ? "all" : tag)}>
              {formatOccasionTag(tag)} <span className="chip-count">{count}</span>
            </button>
          ))}
        </nav>
      )}
      {error && <p className="status error" role="alert">{error}</p>}
      {notice && <p className="status" role="status">{notice}</p>}
      {!outfits.length && !styling && <p className="status empty">{setup?.ready ? t("No outfits yet. Press Style new outfits, or build your own.") : t("No outfits yet. Build your own to start.")}</p>}

      <section className="outfit-grid" aria-label={t("Outfits")}>
        {shown.map((outfit) => (
          <button className="outfit-card" type="button" key={outfit.id} onClick={() => setOpenId(outfit.id)}>
            {outfit.image ? <img src={assetUrl(outfit.image)} alt="" loading="lazy" /> : <FlatLay pieces={outfitPieces(outfit, itemsById)} variant="card" />}
            {outfit.favorite && <span className="outfit-card__heart" aria-label={t("Favorite")}><Heart size={14} weight="fill" aria-hidden="true" /></span>}
            <span className="outfit-card__name">{outfit.name || outfit.id}</span>
            {outfit.occasion?.length > 0 && <span className="outfit-card__occasion">{outfit.occasion.map(formatOccasionTag).join(" · ")}</span>}
            <span className="outfit-card__harmony"><HarmonyBadge harmony={outfitHarmony(outfit, itemsById)} /></span>
          </button>
        ))}
      </section>

      {building && (
        <OutfitBuilder
          items={items}
          onClose={() => setBuilding(false)}
          onCreated={(created) => { setOutfits((current) => [created, ...current]); setBuilding(false); }}
        />
      )}

      {open && (
        <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeViewer()}>
          <aside ref={viewerRef} className="outfit-viewer" role="dialog" aria-modal="true" aria-label={open.name || t("Outfit")}>
            <button ref={viewerCloseRef} className="viewer-icon-close" type="button" onClick={closeViewer} aria-label={t("Close outfit")}>
              <X size={24} weight="light" aria-hidden="true" />
            </button>
            {open.image
              ? <img className="outfit-viewer__photo" src={assetUrl(open.image)} alt={open.name || t("Outfit")} />
              : <div className="outfit-viewer__photo"><FlatLay pieces={openPieces} variant="detail" swappingId={swappingId} /></div>}
            <div className="outfit-viewer__details">
              {editing ? (
                <form onSubmit={(event) => { event.preventDefault(); saveEdit(open.id); }}>
                  <h2>{t("Edit outfit")}</h2>
                  <OutfitFields draft={editing} setDraft={setEditing} />
                  <div className="viewer-actions">
                    <button type="button" className="secondary-button" onClick={() => setEditing(null)}>{t("Cancel")}</button>
                    <button type="submit" className="primary-button"><Check size={14} weight="bold" aria-hidden="true" /> {t("Save")}</button>
                  </div>
                </form>
              ) : (
                <>
                  <h2>{open.name || open.id}</h2>
                  {open.occasion?.length > 0 && <p className="outfit-viewer__occasion">{open.occasion.map(formatOccasionTag).join(" · ")}</p>}
                  <p className="outfit-viewer__harmony"><HarmonyBadge harmony={outfitHarmony(open, itemsById)} /> {t(COLOR_RULES[outfitHarmony(open, itemsById).rule]?.hint || "")}</p>
                  {open.reason && <p>{open.reason}</p>}
                  {wearCount(open) > 0 && <p className="outfit-viewer__worn">{tn(wearCount(open), "Worn {n} time · last {date}", "Worn {n} times · last {date}", { date: formatDay(lastWorn(open), { day: "numeric", month: "short" }) })}</p>}
                  <div className="wear-actions">
                    <button type="button" className={wornOn(open) ? "secondary-button" : "primary-button"} onClick={() => toggleWorn(open)} disabled={wearing} aria-busy={wearing}>
                      {wornOn(open) ? <><ClockCounterClockwise size={15} aria-hidden="true" /> {t("Undo, not worn today")}</> : <><Check size={15} weight="bold" aria-hidden="true" /> {t("Wore it today")}</>}
                    </button>
                    <button type="button" className={`secondary-button outfit-heart${open.favorite ? " is-on" : ""}`} aria-pressed={Boolean(open.favorite)} onClick={() => toggleFavorite(open)}>
                      <Heart size={15} weight={open.favorite ? "fill" : "regular"} aria-hidden="true" /> {open.favorite ? t("In favorites") : t("Save to favorites")}
                    </button>
                  </div>
                </>
              )}
              <PieceList
                pieces={openPieces}
                items={items}
                weather={weather}
                swappingId={swappingId}
                setSwappingId={setSwappingId}
                busy={swapping}
                onSwap={(oldId, newId) => swapPieceInOutfit(open, oldId, newId)}
                onSelect={onSelectGarment && ((id) => { const outfitId = open.id; closeViewer(); onSelectGarment(id, outfitId); })}
              />
              {!editing && confirmingDelete && (
                <div className="confirm-bar" role="alert">
                  <span>{t("Delete this outfit?")}</span>
                  <button type="button" className="secondary-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>{t("Cancel")}</button>
                  <button type="button" className="delete-button" onClick={() => remove(open.id)} disabled={deleting} aria-busy={deleting}>
                    {deleting ? <SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> : <Trash size={14} aria-hidden="true" />} {t("Delete outfit")}
                  </button>
                </div>
              )}
              {!editing && (
                <div className="outfit-viewer__actions">
                  <button
                    className="outfit-edit"
                    type="button"
                    onClick={() => setEditing({ name: open.name || "", occasion: (open.occasion || []).join(", "), reason: open.reason || "" })}
                  >
                    <PencilSimple size={14} aria-hidden="true" /> {t("Edit")}
                  </button>
                  <button className="outfit-delete" type="button" onClick={() => setConfirmingDelete(true)} disabled={deleting}>
                    <Trash size={14} aria-hidden="true" /> {t("Delete outfit")}
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
