import { useEffect, useMemo, useState } from "react";
import { Check, Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { STARTER_COLORS, STARTER_PIECES } from "../shared/starter.mjs";
import { shapeSvg } from "../shared/shapes.mjs";
import { drawnPiecePng } from "./pictures.js";
import { sendJson } from "./wear.js";
import { t } from "./i18n.js";

const GROUPS = [
  ["upperbody", "Tops"], ["wholebody_up", "Jackets"], ["lowerbody", "Bottoms"], ["shoes", "Shoes"], ["accessories_up", "Accessories"],
];

function preview(shape, color) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapeSvg(shape, color))}`;
}

// Add basics without a photo: pick a piece and a color, and it is drawn and
// saved like any other piece. No AI is used.
export function StarterPicker({ onClose, onAdded }) {
  const [colors, setColors] = useState(() => Object.fromEntries(STARTER_PIECES.map((piece) => [piece.id, piece.color])));
  const [busy, setBusy] = useState(null);
  const [added, setAdded] = useState([]);
  const [error, setError] = useState("");
  const groups = useMemo(() => GROUPS.map(([part, label]) => ({ label, pieces: STARTER_PIECES.filter((piece) => piece.part === part) })), []);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.classList.remove("viewer-open"); };
  }, [onClose]);

  const add = async (piece) => {
    setBusy(piece.id); setError("");
    try {
      const color = colors[piece.id];
      const colorLabel = STARTER_COLORS.find((entry) => entry.hex === color)?.label;
      const name = colorLabel ? `${t(colorLabel)} ${t(piece.name).toLowerCase()}` : t(piece.name);
      const record = await sendJson("/api/import/wardrobe", "POST", {
        imageDataUrl: await drawnPiecePng(piece.shape, color),
        name, part: piece.part, color, secondaryColor: null, tags: piece.tags,
        kind: piece.kind, seasons: piece.seasons, warmth: piece.warmth, formality: piece.formality, starter: true,
      }, t("Could not add the piece."));
      onAdded(record);
      setAdded((current) => [...current, `${piece.id}:${color}`]);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet starter-sheet" role="dialog" aria-modal="true" aria-labelledby="starter-title">
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">{t("No photo needed")}</p>
            <h2 id="starter-title">{t("Add basics")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close")}><X size={20} aria-hidden="true" /></button>
        </header>
        <p className="settings-note">{t("Pick a color and tap Add. You can swap in a real photo later.")}</p>
        {error && <p className="status error">{error}</p>}
        {groups.map((group) => (
          <section key={group.label} className="starter-group">
            <h3>{t(group.label)}</h3>
            <div className="starter-list">
              {group.pieces.map((piece) => {
                const color = colors[piece.id];
                const done = added.includes(`${piece.id}:${color}`);
                return (
                  <article className="starter-piece" key={piece.id}>
                    <img src={preview(piece.shape, color)} alt="" />
                    <strong>{t(piece.name)}</strong>
                    <div className="starter-colors" role="group" aria-label={`${t("Color for")} ${t(piece.name)}`}>
                      {STARTER_COLORS.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className={entry.hex === color ? "active" : ""}
                          style={{ backgroundColor: entry.hex }}
                          aria-label={t(entry.label)}
                          aria-pressed={entry.hex === color}
                          onClick={() => setColors((current) => ({ ...current, [piece.id]: entry.hex }))}
                        />
                      ))}
                    </div>
                    <button type="button" className={done ? "secondary-button" : "primary-button"} onClick={() => add(piece)} disabled={busy === piece.id}>
                      {busy === piece.id ? <SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> : done ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                      {done ? t("Added") : t("Add")}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
