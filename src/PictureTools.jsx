import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Check, Eraser, MagicWand, PaintBrush, Scissors, SpinnerGap, X } from "@phosphor-icons/react";
import { canCutOutOnDevice, cutOutOnDevice, frameOnSquare, loadPiecePicture, savePiecePicture } from "./cutout.js";
import { t } from "./i18n.js";

const EDGE = 1000;
const MAX_UNDO = 15;

// Buttons on the piece page: Clean cut on iPhone (when the phone can do it)
// and Fix edges (everywhere). Each saves a new picture for the piece.
export function PictureTools({ item, onSaved }) {
  const [deviceCut, setDeviceCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => { canCutOutOnDevice().then(setDeviceCut); }, []);

  const save = async (dataUrl) => onSaved(await savePiecePicture(item.id, dataUrl));

  const cleanCut = async () => {
    setBusy(true); setError("");
    try { await save(await cutOutOnDevice(item)); } catch (cutError) { setError(cutError.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="picture-tools">
      <div className="cutout-actions">
        {deviceCut && (
          <button className="secondary-button" type="button" onClick={cleanCut} disabled={busy}>
            {busy ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <MagicWand size={15} aria-hidden="true" />}
            {busy ? t("Cutting out") : t("Clean cut on iPhone")}
          </button>
        )}
        <button className="secondary-button" type="button" onClick={() => setEditing(true)} disabled={busy}>
          <Scissors size={15} aria-hidden="true" /> {t("Fix edges")}
        </button>
      </div>
      {error && <p className="status error">{error}</p>}
      {editing && <EdgeEditor item={item} onClose={() => setEditing(false)} onSave={async (dataUrl) => { await save(dataUrl); setEditing(false); }} />}
    </div>
  );
}

// Drag to erase background, or switch to Bring back to paint the original
// picture back in. Works with a finger, a pen or a mouse.
export function EdgeEditor({ item, onClose, onSave }) {
  const canvasRef = useRef(null);
  const originalRef = useRef(null);
  const undoRef = useRef([]);
  const lastRef = useRef(null);
  const [mode, setMode] = useState("erase");
  const [size, setSize] = useState(40);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadPiecePicture(item.image).then((image) => {
      if (cancelled) return;
      const original = document.createElement("canvas");
      original.width = EDGE; original.height = EDGE;
      const scale = Math.min(EDGE / image.naturalWidth, EDGE / image.naturalHeight);
      const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
      original.getContext("2d").drawImage(image, (EDGE - width) / 2, (EDGE - height) / 2, width, height);
      originalRef.current = original;
      const canvas = canvasRef.current;
      canvas.width = EDGE; canvas.height = EDGE;
      canvas.getContext("2d").drawImage(original, 0, 0);
      setReady(true);
    }).catch((loadError) => setError(loadError.message));
    return () => { cancelled = true; };
  }, [item.image]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const point = (event) => {
    const box = canvasRef.current.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * EDGE, y: ((event.clientY - box.top) / box.height) * EDGE, scale: EDGE / box.width };
  };

  const dab = useCallback((from, to) => {
    const context = canvasRef.current.getContext("2d");
    const radius = (size / 2) * to.scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 3)));
    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      context.save();
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      if (mode === "erase") {
        context.globalCompositeOperation = "destination-out";
        context.fill();
      } else {
        context.clip();
        context.clearRect(x - radius, y - radius, radius * 2, radius * 2);
        context.drawImage(originalRef.current, 0, 0);
      }
      context.restore();
    }
  }, [mode, size]);

  const start = (event) => {
    if (!ready) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture?.(event.pointerId);
    const context = canvasRef.current.getContext("2d");
    undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), context.getImageData(0, 0, EDGE, EDGE)];
    setCanUndo(true);
    const at = point(event);
    lastRef.current = at;
    dab(at, at);
  };
  const move = (event) => {
    if (!lastRef.current) return;
    event.preventDefault();
    const at = point(event);
    dab(lastRef.current, at);
    lastRef.current = at;
  };
  const end = () => { lastRef.current = null; };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (previous) canvasRef.current.getContext("2d").putImageData(previous, 0, 0);
    setCanUndo(undoRef.current.length > 0);
  };

  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(frameOnSquare(trimmed(canvasRef.current))); }
    catch (saveError) { setError(saveError.message); setSaving(false); }
  };

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-sheet edge-editor" role="dialog" aria-modal="true" aria-labelledby="edge-title">
        <header className="settings-sheet__header">
          <div>
            <p className="eyebrow">{t("Picture")}</p>
            <h2 id="edge-title">{t("Fix edges")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close")}><X size={20} aria-hidden="true" /></button>
        </header>
        <p className="settings-note">{t("Drag over the picture to erase the background or bring back parts of the piece.")}</p>
        <div className="edge-editor__canvas">
          <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} aria-label={t("Picture")} />
          {!ready && !error && <SpinnerGap size={24} className="import-spinner edge-editor__wait" aria-hidden="true" />}
        </div>
        <div className="edge-editor__tools">
          <div className="segmented" role="group" aria-label={t("Brush")}>
            <button type="button" className={mode === "erase" ? "active" : ""} aria-pressed={mode === "erase"} onClick={() => setMode("erase")}><Eraser size={15} aria-hidden="true" /> {t("Erase")}</button>
            <button type="button" className={mode === "restore" ? "active" : ""} aria-pressed={mode === "restore"} onClick={() => setMode("restore")}><PaintBrush size={15} aria-hidden="true" /> {t("Bring back")}</button>
          </div>
          <label>{t("Brush size")}<input type="range" min="10" max="120" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
        </div>
        {error && <p className="status error">{error}</p>}
        <div className="settings-actions">
          <button className="secondary-button" type="button" onClick={undo} disabled={!canUndo}><ArrowCounterClockwise size={15} aria-hidden="true" /> {t("Undo")}</button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={onClose}>{t("Cancel")}</button>
          <button className="primary-button" type="button" onClick={save} disabled={!ready || saving}>
            {saving ? <SpinnerGap size={15} className="import-spinner" aria-hidden="true" /> : <Check size={15} weight="bold" aria-hidden="true" />} {t("Save picture")}
          </button>
        </div>
      </section>
    </div>
  );
}

// Crops away clear edges so the framing step centers what is left.
export function trimmed(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(t("Nothing is left in the picture."));
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
