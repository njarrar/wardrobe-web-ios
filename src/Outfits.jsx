import { useEffect, useMemo, useState } from "react";
import { Check, CoatHanger, MagicWand, PencilSimple, Plus, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import "./outfits.css";

// The Outfits tab: outfits the AI styles, outfits built by hand, an occasion
// filter, and a viewer where an outfit can be edited or deleted.

const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];
const PART_LABELS = {
  wholebody_up: "Jackets",
  upperbody: "Tops",
  lowerbody: "Bottoms",
  shoes: "Shoes",
  accessories_up: "Accessories",
};
const QUICK_PROMPTS = ["Weekend in the city", "Smart casual office", "Dinner out", "Cold and rainy"];

function outfitPieces(outfit, itemsById) {
  return (outfit.garmentIds || [])
    .map((id) => itemsById.get(id))
    .filter(Boolean)
    .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
}

// "work, Weekend ,," -> ["work", "weekend"]. The server trims and caps these too.
function splitOccasions(text) {
  return text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

async function sendJson(path, method, payload, failure) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || failure);
  return value;
}

// New outfits have no photo; show the garment cutouts together instead.
function Collage({ pieces }) {
  const shown = pieces.slice(0, 4);
  return (
    <div className={`outfit-collage outfit-collage--${shown.length}`} aria-hidden="true">
      {shown.map((item) => <img key={item.id} src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />)}
    </div>
  );
}

function StyleForm({ busy, onStyle, onCompose, canCompose }) {
  const [count, setCount] = useState(4);
  const [notes, setNotes] = useState("");
  return (
    <form className="outfit-style-form" onSubmit={(event) => { event.preventDefault(); onStyle({ count, notes }); }}>
      <label>
        <span>Outfits</span>
        <select id="outfit-count" value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={busy}>
          {[1, 2, 3, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="outfit-style-form__notes">
        <span>Anything in mind? <em>optional</em></span>
        <input id="outfit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Weekend in the city, cool weather" maxLength={500} disabled={busy} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <MagicWand size={15} aria-hidden="true" />}
        {busy ? "Styling" : "Style new outfits"}
      </button>
      <div className="outfit-style-form__footer">
        <div className="outfit-prompts" aria-label="Ideas">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={notes === prompt ? "active" : ""}
              aria-pressed={notes === prompt}
              onClick={() => setNotes((current) => (current === prompt ? "" : prompt))}
              disabled={busy}
            >
              {prompt}
            </button>
          ))}
        </div>
        {canCompose && (
          <button type="button" className="outfit-compose" onClick={onCompose}>
            <CoatHanger size={15} aria-hidden="true" /> Build your own
          </button>
        )}
      </div>
    </form>
  );
}

// The pieces inside an open outfit. Tapping one opens it in the item editor.
function PieceList({ pieces, onSelect }) {
  return (
    <div className="outfit-viewer__pieces">
      {pieces.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelect?.(item.id)} disabled={!onSelect}>
          <img src={assetUrl(item.thumbnail || item.image)} alt="" />
          <span>{item.name}</span>
        </button>
      ))}
    </div>
  );
}

function OutfitFields({ draft, setDraft }) {
  const change = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  return (
    <div className="outfit-fields">
      <label className="field">
        <span>Name</span>
        <input id="outfit-name" value={draft.name} onChange={change("name")} placeholder="Easy Saturday" maxLength={80} />
      </label>
      <label className="field">
        <span>Occasions, separated by commas</span>
        <input id="outfit-occasion" value={draft.occasion} onChange={change("occasion")} placeholder="weekend, coffee" />
      </label>
      <label className="field">
        <span>Note</span>
        <input id="outfit-reason" value={draft.reason} onChange={change("reason")} placeholder="Why these go together" maxLength={400} />
      </label>
    </div>
  );
}

// "Build your own": pick two or more pieces, then save them as an outfit.
function OutfitBuilder({ items, onClose, onCreated }) {
  const [draft, setDraft] = useState({ name: "", occasion: "", reason: "" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const groups = useMemo(() => PART_ORDER
    .map((part) => ({ part, items: items.filter((item) => item.part === part) }))
    .filter((group) => group.items.length), [items]);
  const selected = selectedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);

  const toggle = (id) => setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const value = await sendJson("/api/import/outfits", "POST", {
        name: draft.name,
        occasion: splitOccasions(draft.occasion),
        reason: draft.reason,
        garmentIds: selectedIds,
      }, "Could not save the outfit.");
      onCreated(value.outfit);
    } catch (requestError) { setError(requestError.message); setSaving(false); }
  };

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="outfit-viewer outfit-builder" role="dialog" aria-modal="true" aria-label="Build an outfit">
        <button className="viewer-icon-close" type="button" onClick={onClose} aria-label="Close">
          <X size={24} weight="light" aria-hidden="true" />
        </button>
        <div className="outfit-viewer__photo">
          {selected.length
            ? <Collage pieces={selected} />
            : <p className="outfit-builder__empty"><CoatHanger size={32} weight="light" aria-hidden="true" />Pick at least two pieces</p>}
        </div>
        <form className="outfit-viewer__details" onSubmit={submit}>
          <h2>Build an outfit</h2>
          <OutfitFields draft={draft} setDraft={setDraft} />
          {groups.map((group) => (
            <fieldset className="outfit-builder__group" key={group.part}>
              <legend>{PART_LABELS[group.part]}</legend>
              <div className="outfit-builder__items">
                {group.items.map((item) => {
                  const active = selectedIds.includes(item.id);
                  return (
                    <button key={item.id} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => toggle(item.id)}>
                      <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
                      <span>{item.name}</span>
                      {active && <Check className="outfit-builder__check" size={12} weight="bold" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {error && <p className="status error">{error}</p>}
          <div className="viewer-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || selectedIds.length < 2}>
              <Plus size={15} weight="bold" aria-hidden="true" /> {saving ? "Saving" : "Save outfit"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

export function OutfitGallery({ items, onSelectGarment }) {
  const [outfits, setOutfits] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [styling, setStyling] = useState(false);
  const [notice, setNotice] = useState("");
  const [occasion, setOccasion] = useState("all");
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  useEffect(() => {
    apiFetch("/api/import/outfits", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load outfits.");
        return response.json();
      })
      .then(setOutfits)
      .catch((requestError) => setError(requestError.message));
  }, []);

  const closeViewer = () => { setOpenId(null); setEditing(null); };

  useEffect(() => {
    if (!openId && !building) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      closeViewer();
      setBuilding(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
    };
  }, [openId, building]);

  const occasions = useMemo(() => {
    const counts = new Map();
    for (const outfit of outfits || []) {
      for (const tag of outfit.occasion || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [outfits]);

  // Drop a filter whose last outfit was deleted or renamed away.
  useEffect(() => {
    if (occasion !== "all" && !occasions.some(([tag]) => tag === occasion)) setOccasion("all");
  }, [occasion, occasions]);

  const style = async ({ count, notes }) => {
    setStyling(true); setError(""); setNotice("");
    try {
      const value = await sendJson("/api/import/outfits/generate", "POST", { count, notes }, "Could not style outfits.");
      const created = value.outfits || [];
      setOutfits((current) => [...(current || []), ...created]);
      if (!created.length) setNotice("No new combinations found. Add more pieces and try again.");
      else if (created.length < count) setNotice(`Found ${created.length} new ${created.length === 1 ? "outfit" : "outfits"} in your wardrobe.`);
    } catch (requestError) { setError(requestError.message); }
    finally { setStyling(false); }
  };

  const saveEdit = async (id) => {
    setError("");
    try {
      const updated = await sendJson(`/api/import/outfits/${encodeURIComponent(id)}`, "PATCH", {
        name: editing.name,
        occasion: splitOccasions(editing.occasion),
        reason: editing.reason,
      }, "Could not save the outfit.");
      setOutfits((current) => current.map((outfit) => (outfit.id === id ? updated : outfit)));
      setEditing(null);
    } catch (requestError) { setError(requestError.message); }
  };

  const remove = async (id) => {
    setError("");
    try {
      const response = await apiFetch(`/api/import/outfits/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete the outfit.");
      setOutfits((current) => current.filter((outfit) => outfit.id !== id));
      closeViewer();
    } catch (requestError) { setError(requestError.message); }
  };

  if (!outfits) return error ? <p className="status error">{error}</p> : <p className="status">Loading outfits</p>;

  const shown = occasion === "all" ? outfits : outfits.filter((outfit) => (outfit.occasion || []).includes(occasion));
  const open = outfits.find((outfit) => outfit.id === openId);
  const openPieces = open ? outfitPieces(open, itemsById) : [];

  return (
    <>
      <StyleForm busy={styling} onStyle={style} canCompose={items.length >= 2} onCompose={() => setBuilding(true)} />
      {occasions.length > 0 && (
        <nav className="category-nav outfit-occasions" aria-label="Filter outfits by occasion">
          <button type="button" className={occasion === "all" ? "active" : ""} aria-pressed={occasion === "all"} onClick={() => setOccasion("all")}>
            All <span className="chip-count">{outfits.length}</span>
          </button>
          {occasions.map(([tag, count]) => (
            <button key={tag} type="button" className={occasion === tag ? "active" : ""} aria-pressed={occasion === tag} onClick={() => setOccasion(occasion === tag ? "all" : tag)}>
              {tag} <span className="chip-count">{count}</span>
            </button>
          ))}
        </nav>
      )}
      {error && <p className="status error">{error}</p>}
      {notice && <p className="status">{notice}</p>}
      {!outfits.length && !styling && <p className="status empty">No outfits yet. Press Style new outfits, or build your own.</p>}

      <section className="outfit-grid" aria-label="Outfits">
        {shown.map((outfit) => (
          <button className="outfit-card" type="button" key={outfit.id} onClick={() => setOpenId(outfit.id)}>
            {outfit.image ? <img src={assetUrl(outfit.image)} alt="" loading="lazy" /> : <Collage pieces={outfitPieces(outfit, itemsById)} />}
            <span className="outfit-card__name">{outfit.name || outfit.id}</span>
            {outfit.occasion?.length > 0 && <span className="outfit-card__occasion">{outfit.occasion.join(" · ")}</span>}
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
          <aside className="outfit-viewer" role="dialog" aria-modal="true" aria-label={open.name || "Outfit"}>
            <button className="viewer-icon-close" type="button" onClick={closeViewer} aria-label="Close outfit">
              <X size={24} weight="light" aria-hidden="true" />
            </button>
            {open.image
              ? <img className="outfit-viewer__photo" src={assetUrl(open.image)} alt={`${open.name || "Outfit"} worn by a model`} />
              : <div className="outfit-viewer__photo"><Collage pieces={openPieces} /></div>}
            <div className="outfit-viewer__details">
              {editing ? (
                <form onSubmit={(event) => { event.preventDefault(); saveEdit(open.id); }}>
                  <h2>Edit outfit</h2>
                  <OutfitFields draft={editing} setDraft={setEditing} />
                  <div className="viewer-actions">
                    <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="submit" className="primary-button"><Check size={14} weight="bold" aria-hidden="true" /> Save</button>
                  </div>
                </form>
              ) : (
                <>
                  <h2>{open.name || open.id}</h2>
                  {open.occasion?.length > 0 && <p className="outfit-viewer__occasion">{open.occasion.join(" · ")}</p>}
                  {open.reason && <p>{open.reason}</p>}
                </>
              )}
              <PieceList pieces={openPieces} onSelect={onSelectGarment && ((id) => { closeViewer(); onSelectGarment(id); })} />
              {!editing && (
                <div className="outfit-viewer__actions">
                  <button
                    className="outfit-edit"
                    type="button"
                    onClick={() => setEditing({ name: open.name || "", occasion: (open.occasion || []).join(", "), reason: open.reason || "" })}
                  >
                    <PencilSimple size={14} aria-hidden="true" /> Edit
                  </button>
                  <button className="outfit-delete" type="button" onClick={() => remove(open.id)}>
                    <Trash size={14} aria-hidden="true" /> Delete outfit
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
