import { useMemo, useRef, useState } from "react";
import { Check, Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { STARTER_COLORS, STARTER_PIECES } from "../shared/starter.mjs";
import { shapeSvg } from "../shared/shapes.mjs";
import { drawnPiecePng } from "./pictures.js";
import { sendJson } from "./wear.js";
import { isRtl, t, tn } from "./i18n.js";
import { useDialog } from "./dialog.js";

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
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [added, setAdded] = useState([]);
  const [error, setError] = useState("");
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  useDialog({ open: true, onClose, initialFocusRef: closeRef, containerRef: sheetRef });

  const groups = useMemo(() => GROUPS.map(([part, label]) => ({ label, pieces: STARTER_PIECES.filter((piece) => piece.part === part) })), []);

  const add = async (piece) => {
    const color = colors[piece.id];
    const entryKey = `${piece.id}:${color}`;
    if (added.includes(entryKey) || busyIds.has(piece.id)) return;

    setBusyIds((current) => new Set(current).add(piece.id));
    setError("");
    try {
      const colorLabel = STARTER_COLORS.find((entry) => entry.hex === color)?.label;
      const pieceName = t(piece.name);
      const name = colorLabel
        ? t("{color} {piece}", { color: t(colorLabel), piece: isRtl() ? pieceName : pieceName.toLowerCase() })
        : pieceName;
      const record = await sendJson("/api/import/wardrobe", "POST", {
        imageDataUrl: await drawnPiecePng(piece.shape, color),
        name,
        part: piece.part,
        color,
        secondaryColor: null,
        tags: piece.tags,
        kind: piece.kind,
        seasons: piece.seasons,
        warmth: piece.warmth,
        formality: piece.formality,
        pattern: piece.pattern,
        starter: true,
      }, t("Could not add the piece."));
      onAdded(record);
      setAdded((current) => (current.includes(entryKey) ? current : [...current, entryKey]));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(piece.id);
        return next;
      });
    }
  };

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} className="settings-sheet starter-sheet" role="dialog" aria-modal="true" aria-labelledby="starter-title">
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">{t("No photo needed")}</p>
            <h2 id="starter-title">{t("Add basics")}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label={t("Close")}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <p className="settings-note">{t("Pick a color and tap Add. You can swap in a real photo later.")}</p>
        {error && <p className="status error" role="alert">{error}</p>}
        {groups.map((group) => (
          <section key={group.label} className="starter-group">
            <h3>{t(group.label)}</h3>
            <div className="starter-list">
              {group.pieces.map((piece) => {
                const color = colors[piece.id];
                const done = added.includes(`${piece.id}:${color}`);
                const isBusy = busyIds.has(piece.id);
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
                    <button
                      type="button"
                      className={done ? "secondary-button" : "primary-button"}
                      onClick={() => add(piece)}
                      disabled={isBusy || done}
                      aria-busy={isBusy}
                    >
                      {isBusy
                        ? <SpinnerGap size={14} className="import-spinner" aria-hidden="true" />
                        : done ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                      {done ? t("Added") : t("Add")}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        <footer className="starter-footer">
          <span role="status">
            {added.length > 0 ? tn(added.length, "{n} piece added", "{n} pieces added") : t("Pick a color and tap Add.")}
          </span>
          <button type="button" className="primary-button" onClick={onClose}>
            {t("Done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
