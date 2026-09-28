import { useEffect, useMemo, useState } from "react";
import { MagicWand, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import "./outfits.css";

const PART_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "accessories_up"];

function outfitPieces(outfit, itemsById) {
  return (outfit.garmentIds || [])
    .map((id) => itemsById.get(id))
    .filter(Boolean)
    .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
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

function StyleForm({ busy, onStyle }) {
  const [count, setCount] = useState(4);
  const [notes, setNotes] = useState("");
  return (
    <form className="outfit-style-form" onSubmit={(event) => { event.preventDefault(); onStyle({ count, notes }); }}>
      <label>
        <span>Outfits</span>
        <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={busy}>
          {[1, 2, 3, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="outfit-style-form__notes">
        <span>Anything in mind? <em>optional</em></span>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Weekend in the city, cool weather" maxLength={500} disabled={busy} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <MagicWand size={15} aria-hidden="true" />}
        {busy ? "Claude is styling" : "Style new outfits"}
      </button>
    </form>
  );
}

export function OutfitGallery({ items }) {
  const [outfits, setOutfits] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [styling, setStyling] = useState(false);
  const [notice, setNotice] = useState("");
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

  useEffect(() => {
    if (!openId) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setOpenId(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openId]);

  const style = async ({ count, notes }) => {
    setStyling(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/import/outfits/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, notes }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || "Claude could not style outfits.");
      const created = value.outfits || [];
      setOutfits((current) => [...(current || []), ...created]);
      if (!created.length) setNotice("Claude found no new combinations. Add more pieces and try again.");
      else if (created.length < count) setNotice(`Claude found ${created.length} new ${created.length === 1 ? "outfit" : "outfits"} in your wardrobe.`);
    } catch (requestError) { setError(requestError.message); }
    finally { setStyling(false); }
  };

  const remove = async (id) => {
    setError("");
    try {
      const response = await apiFetch(`/api/import/outfits/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete the outfit.");
      setOutfits((current) => current.filter((outfit) => outfit.id !== id));
      setOpenId(null);
    } catch (requestError) { setError(requestError.message); }
  };

  if (!outfits) return error ? <p className="status error">{error}</p> : <p className="status">Loading outfits</p>;

  const open = outfits.find((outfit) => outfit.id === openId);
  const openPieces = open ? outfitPieces(open, itemsById) : [];

  return (
    <>
      <StyleForm busy={styling} onStyle={style} />
      {error && <p className="status error">{error}</p>}
      {notice && <p className="status">{notice}</p>}
      {!outfits.length && !styling && <p className="status empty">No outfits yet. Ask Claude to style some looks from your wardrobe.</p>}

      <section className="outfit-grid" aria-label="Outfits">
        {outfits.map((outfit) => (
          <button className="outfit-card" type="button" key={outfit.id} onClick={() => setOpenId(outfit.id)}>
            {outfit.image ? <img src={assetUrl(outfit.image)} alt="" loading="lazy" /> : <Collage pieces={outfitPieces(outfit, itemsById)} />}
            <span className="outfit-card__name">{outfit.name || outfit.id}</span>
          </button>
        ))}
      </section>

      {open && (
        <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpenId(null)}>
          <aside className="outfit-viewer" role="dialog" aria-modal="true" aria-label={open.name || "Outfit"}>
            <button className="viewer-icon-close" type="button" onClick={() => setOpenId(null)} aria-label="Close outfit">
              <X size={24} weight="light" aria-hidden="true" />
            </button>
            {open.image
              ? <img className="outfit-viewer__photo" src={assetUrl(open.image)} alt={`${open.name || "Outfit"} worn by a model`} />
              : <div className="outfit-viewer__photo"><Collage pieces={openPieces} /></div>}
            <div className="outfit-viewer__details">
              <h2>{open.name || open.id}</h2>
              {Array.isArray(open.occasion) && open.occasion.length > 0 && <p className="outfit-viewer__occasion">{open.occasion.join(" · ")}</p>}
              {open.reason && <p>{open.reason}</p>}
              <div className="outfit-viewer__pieces">
                {openPieces.map((item) => (
                  <figure key={item.id}>
                    <img src={assetUrl(item.thumbnail || item.image)} alt="" />
                    <figcaption>{item.name}</figcaption>
                  </figure>
                ))}
              </div>
              <button className="outfit-delete" type="button" onClick={() => remove(open.id)}>
                <Trash size={14} aria-hidden="true" /> Delete outfit
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
