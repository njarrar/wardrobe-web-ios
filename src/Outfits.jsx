import { useEffect, useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import "./outfits.css";

export function OutfitGallery({ items }) {
  const [outfits, setOutfits] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
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

  if (error) return <p className="status error">{error}</p>;
  if (!outfits) return <p className="status">Loading outfits</p>;
  if (!outfits.length) return <p className="status empty">No outfits yet. Run the generate-outfits skill to style some looks.</p>;

  const open = outfits.find((outfit) => outfit.id === openId);

  return (
    <>
      <section className="outfit-grid" aria-label="Outfits">
        {outfits.map((outfit) => (
          <button className="outfit-card" type="button" key={outfit.id} onClick={() => setOpenId(outfit.id)}>
            {outfit.image && <img src={assetUrl(outfit.image)} alt="" loading="lazy" />}
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
            {open.image && <img className="outfit-viewer__photo" src={assetUrl(open.image)} alt={`${open.name || "Outfit"} worn by a model`} />}
            <div className="outfit-viewer__details">
              <h2>{open.name || open.id}</h2>
              {Array.isArray(open.occasion) && open.occasion.length > 0 && <p className="outfit-viewer__occasion">{open.occasion.join(" · ")}</p>}
              {open.reason && <p>{open.reason}</p>}
              <div className="outfit-viewer__pieces">
                {(open.garmentIds || []).map((id) => {
                  const item = itemsById.get(id);
                  if (!item) return null;
                  return (
                    <figure key={id}>
                      <img src={assetUrl(item.thumbnail || item.image)} alt="" />
                      <figcaption>{item.name}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
