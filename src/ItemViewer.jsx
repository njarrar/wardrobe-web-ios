import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClockCounterClockwise, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { PieceRead } from "./PiecePage.jsx";
import { useSheetDrag } from "./useSheetDrag.js";
import { PATTERNS, PATTERN_LABELS } from "../shared/pairing.mjs";
import { wornOn } from "./wear.js";
import { costPerWear, formatMoney, idleLabel, lastWorn, wearCount } from "../shared/style.mjs";
import { locale, t, tn } from "./i18n.js";
import { SEASON_LABELS, TYPES, TYPE_MAP } from "./closet-types.js";
import { buildSamplingCanvas, extractPalette, sampleImageColor } from "./colors.js";

const PictureTools = lazy(() => import("./PictureTools.jsx").then((module) => ({ default: module.PictureTools })));

// The page for one piece: read it, wear it, edit it, delete it.
export function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={t("Remove {name}", { name: tag })}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder={t("Add a detail")}
          aria-label={t("Add detail tag")}
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label={t("Add detail")}>
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{t(label)}</span>
          <small>{t("Optional")}</small>
        </div>
        <p>{t("No distinct secondary color detected.")}</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>{t("Add secondary color")}</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{t(label)}</span>
        {optional && <button type="button" onClick={onClear}>{t("Remove")}</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        <span className="selected-color-copy">
          <small>{t("Selected")}</small>
          <strong>{value || t("Custom")}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>{t("Image suggestions")}</span>
        <small>{t("Tap one to use it")}</small>
      </div>
      <div className="palette" aria-label={t("{label} suggestions from image", { label })}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`${label}: ${color}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? t("Cancel picking") : t("Pick {label} from image", { label: label.toLowerCase() })}
      </button>
    </div>
  );
}

export function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>{t("Name")}</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={t(TYPE_MAP[draft.part]?.singular || t("Wardrobe item"))}
        />
      </label>

      <label className="field">
        <span>{t("Category")}</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{t(type.label)}</option>)}
        </select>
      </label>

      <fieldset className="color-field">
        <legend>{t("Colors")}</legend>
        <div className="colors-editor">
          <ColorControl
            label="Primary color"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="Secondary color"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? t("Click garment to sample") : sampleStatus || t("Primary colors come from the image. A secondary is suggested only when a distinct color has meaningful coverage.")}</p>
      </fieldset>

      <div className="sort-fields">
        <label className="field">
          <span>{t("Kind")}</span>
          <input value={draft.kind || ""} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))} placeholder={t("sweater")} maxLength={30} />
        </label>
        <label className="field">
          <span>{t("Warmth")}</span>
          <select value={draft.warmth || ""} onChange={(event) => setDraft((current) => ({ ...current, warmth: event.target.value ? Number(event.target.value) : "" }))}>
            <option value="">{t("Not set")}</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {t(["very light", "light", "medium", "warm", "very warm"][value - 1])}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("Dress level")}</span>
          <select value={draft.formality || ""} onChange={(event) => setDraft((current) => ({ ...current, formality: event.target.value }))}>
            <option value="">{t("Not set")}</option>
            <option value="casual">{t("Casual")}</option>
            <option value="smart">{t("Smart")}</option>
            <option value="formal">{t("Formal")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("Pattern")}</span>
          <select value={draft.pattern || ""} onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))}>
            <option value="">{t("Not set")}</option>
            {PATTERNS.map((value) => <option key={value} value={value}>{t(PATTERN_LABELS[value])}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="season-field">
        <legend>{t("Seasons")}</legend>
        {Object.entries(SEASON_LABELS).map(([id, label]) => {
          const on = (draft.seasons || []).includes(id);
          return (
            <button key={id} type="button" className={on ? "active" : ""} aria-pressed={on} onClick={() => setDraft((current) => ({ ...current, seasons: on ? (current.seasons || []).filter((season) => season !== id) : [...(current.seasons || []), id] }))}>
              {t(label)}
            </button>
          );
        })}
      </fieldset>

      <label className="field">
        <span>{t("Price paid")} <em className="field-optional">{t("optional, for cost per wear")}</em></span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={draft.price ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
          placeholder="0"
        />
      </label>

      <div className="field details-field">
        <span>{t("Details")}</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

export function WearStats({ item }) {
  const perWear = costPerWear(item);
  const last = lastWorn(item);
  return (
    <dl className="wear-stats">
      <div><dt>{t("Worn")}</dt><dd>{tn(wearCount(item), "{n} time", "{n} times")}</dd></div>
      <div><dt>{t("Last worn")}</dt><dd>{last ? new Date(`${last}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : t("Never")}</dd></div>
      <div><dt>{t("Per wear")}</dt><dd>{perWear === null ? "-" : formatMoney(perWear)}</dd></div>
    </dl>
  );
}

export function ItemViewer({ item, items, onOpen, onClose, onSave, onDelete, onWear, onPicture, onStyleWith }) {
  // The page opens to read. Edit turns the fields on.
  const [editing, setEditing] = useState(false);
  useEffect(() => { setEditing(false); }, [item.id]);
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", pattern: item.pattern || "", seasons: [...(item.seasons || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const type = t(TYPE_MAP[item.part]?.singular || t("Wardrobe item"));
  const hasModeledImage = Boolean(item.modeledImage);
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
      price: draft.price === "" || draft.price === null ? null : Number(draft.price),
      kind: draft.kind.trim().toLowerCase(), warmth: draft.warmth || null, formality: draft.formality || null, pattern: draft.pattern || null, seasons: [...draft.seasons].sort(),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
      price: item.price ?? null,
      kind: item.kind || "", warmth: item.warmth || null, formality: item.formality || null, pattern: item.pattern || null, seasons: [...(item.seasons || [])].sort(),
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);
  const { handleProps, sheetStyle } = useSheetDrag(requestClose);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", pattern: item.pattern || "", seasons: [...(item.seasons || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", pattern: item.pattern || "", seasons: [...(item.seasons || [])] });
    setSampling(null);
    setSampleStatus("");
    setEditing(false);
  };

  const saveEditing = async () => {
    setSampling(null);
    try {
      await onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean), price: draft.price === "" ? null : Number(draft.price), kind: draft.kind.trim().toLowerCase() || null, warmth: draft.warmth || null, formality: draft.formality || null, pattern: draft.pattern || null, seasons: draft.seasons });
      setSampleStatus(t("Changes saved."));
      setEditing(false);
    } catch (error) {
      setSampleStatus(error.message);
    }
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus(t("That spot is see-through. Tap right on the garment."));
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(t("Sampled {color} as the {field} color.", { color, field: t(sampling === "secondary" ? "secondary color" : "primary color") }));
    setSampling(null);
  };

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={type}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">{t("Click garment to sample")}</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer${editing ? " editing" : " reading"}${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label={t("Selected wardrobe item")} style={sheetStyle}>
      <span className="sheet-grabber" aria-hidden="true" {...handleProps} />
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label={t("Close viewer")} ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`${draft.name || type} worn by a model`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading" {...handleProps}>
            <div>
              <h2>{draft.name || t(TYPE_MAP[draft.part]?.singular || t("Wardrobe item"))}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading" {...handleProps}>
            <div>
              <h2>{draft.name || t(TYPE_MAP[draft.part]?.singular || t("Wardrobe item"))}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        <WearStats item={item} />
        <p className="wear-idle">{idleLabel(item, undefined, t, locale())}</p>
        <div className="wear-actions">
          <button className={wornOn(item) ? "secondary-button" : "primary-button"} type="button" onClick={() => onWear(item.id, wornOn(item))}>
            {wornOn(item) ? <><ClockCounterClockwise size={15} aria-hidden="true" /> {t("Undo, not worn today")}</> : <><Check size={15} weight="bold" aria-hidden="true" /> {t("Wore today")}</>}
          </button>
        </div>
        {!editing && (
          <>
            <PieceRead item={item} items={items} category={t(TYPE_MAP[item.part]?.label || "")} onOpen={onOpen} onStyleWith={onStyleWith} />
            <div className="viewer-actions">
              <span className="action-spacer" />
              <button className="secondary-button" type="button" onClick={() => setEditing(true)}>
                <PencilSimple size={15} aria-hidden="true" /> {t("Edit")}
              </button>
            </div>
          </>
        )}
        {editing && onPicture && <Suspense fallback={null}><PictureTools item={item} onSaved={onPicture} /></Suspense>}
        {editing && <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />}

        {closeBlocked && <p className="unsaved-notice" role="status">{t("Save or cancel changes before closing.")}</p>}

        {editing && <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> {t("Delete")}
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>{t("Cancel")}</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> {t("Save")}
          </button>
        </div>}
      </div>
    </aside>
    </div>
    </div>
  );
}
