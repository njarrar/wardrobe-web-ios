import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, CalendarBlank, Check, ClockCounterClockwise, CoatHanger, GearSix, MagicWand, MagnifyingGlass, Plus, Sparkle, SpinnerGap, Trash, TShirt, X } from "@phosphor-icons/react";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitGallery } from "./Outfits.jsx";
import { ConnectScreen } from "./ConnectScreen.jsx";
import { SettingsSheet } from "./SettingsSheet.jsx";
import { AiConsentPrompt } from "./AiConsentPrompt.jsx";
import { AUTH_EVENT, apiFetch, ensureImageKey, isNativeApp, needsServerUrl } from "./api.js";
import { ForgottenRow, TodayCard } from "./Today.jsx";
import { PlanView, usePlan } from "./Plan.jsx";
import { StarterPicker } from "./StarterPicker.jsx";
import { PictureTools } from "./PictureTools.jsx";
import { useWeather } from "./weather.js";
import { askAiConsent, useAiSetup } from "./ai-setup.js";
import { sendJson, wearPiece, wornOn } from "./wear.js";
import { costPerWear, dayString, formatMoney, idleLabel, isNeutral, itemWarmth, lastWorn, wearCount } from "../shared/style.mjs";
import { formatDay, locale, t, tn } from "./i18n.js";

const LEGACY_EDITS_KEY = "open-wardrobe-edits-v1";
const LEGACY_DELETED_KEY = "open-wardrobe-deleted-v1";

const TYPES = [
  { id: "all", label: "All" },
  { id: "upperbody", label: "Tops", singular: "Top" },
  { id: "wholebody_up", label: "Jackets", singular: "Jacket" },
  { id: "lowerbody", label: "Bottoms", singular: "Bottom" },
  { id: "accessories_up", label: "Accessories", singular: "Accessory" },
  { id: "shoes", label: "Shoes", singular: "Shoes" },
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));


// Older versions kept edits in this browser only. Read them once so they can
// be moved into library.json, then drop them.
function takeLegacyEdits() {
  try {
    const edits = JSON.parse(localStorage.getItem(LEGACY_EDITS_KEY) || "{}");
    localStorage.removeItem(LEGACY_EDITS_KEY);
    localStorage.removeItem(LEGACY_DELETED_KEY);
    return edits && typeof edits === "object" ? edits : {};
  } catch {
    return {};
  }
}

async function saveItemToServer(id, changes) {
  const response = await apiFetch(`/api/import/wardrobe/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Could not save your changes.");
  return value;
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function hexToHue(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return { hue: 999, sat: 0, light: 0 };
  const value = parseInt(match[1], 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { hue: 999, sat: 0, light };
  const sat = delta / (1 - Math.abs((2 * light) - 1));
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = ((blue - red) / delta) + 2;
  else hue = ((red - green) / delta) + 4;
  return { hue: (hue * 60 + 360) % 360, sat, light };
}

// Neutrals (low saturation) go last, dark to light; colors follow the wheel.
function colorSortKey(item) {
  const { hue, sat, light } = hexToHue(item.color);
  return sat < 0.14 ? 1000 + (light * 100) : hue;
}

// Plain color words, so "blue" or "beige" finds pieces by their hex color.
const COLOR_FAMILIES = [
  { id: "black", label: "Black", swatch: "#1f1f1f" },
  { id: "grey", label: "Grey", swatch: "#8d8d8d" },
  { id: "white", label: "White", swatch: "#f1efea" },
  { id: "beige", label: "Beige", swatch: "#d6c4a3" },
  { id: "brown", label: "Brown", swatch: "#7a5134" },
  { id: "red", label: "Red", swatch: "#c23b32" },
  { id: "orange", label: "Orange", swatch: "#e0823a" },
  { id: "yellow", label: "Yellow", swatch: "#e6c34a" },
  { id: "green", label: "Green", swatch: "#5f7a45" },
  { id: "blue", label: "Blue", swatch: "#34528f" },
  { id: "purple", label: "Purple", swatch: "#7a4e98" },
  { id: "pink", label: "Pink", swatch: "#e79bb4" },
];

function colorFamily(hex) {
  const { hue, sat, light } = hexToHue(hex);
  if (!/^#?[0-9a-f]{6}$/i.test(hex || "")) return null;
  if (light < 0.16) return "black";
  if (light > 0.9) return "white";
  if (sat < 0.14) return light > 0.75 ? "white" : "grey";
  if (hue >= 15 && hue < 50) {
    if (light < 0.45) return "brown";
    if (sat < 0.55 || light > 0.7) return "beige";
    return "orange";
  }
  if (hue >= 50 && hue < 70) return sat < 0.4 ? "beige" : "yellow";
  if (hue >= 70 && hue < 170) return "green";
  if (hue >= 170 && hue < 255) return "blue";
  if (hue >= 255 && hue < 295) return "purple";
  if (hue >= 295 && hue < 345) return light > 0.6 ? "pink" : "purple";
  return light > 0.72 ? "pink" : light < 0.3 ? "brown" : "red";
}

function itemFamilies(item) {
  return [...new Set([item.color, item.secondaryColor].map(colorFamily).filter(Boolean))];
}

// Smart groups built from what the AI (or you) said about each piece.
const GROUPS = [
  { id: "winter", label: "Winter", test: (item) => item.seasons?.includes("winter") || (!item.seasons && itemWarmth(item) >= 4) },
  { id: "summer", label: "Summer", test: (item) => item.seasons?.includes("summer") || (!item.seasons && itemWarmth(item) <= 2) },
  { id: "spring-fall", label: "Spring and fall", test: (item) => item.seasons?.includes("spring") || item.seasons?.includes("fall") },
  { id: "work", label: "Work", test: (item) => item.formality === "smart" || item.formality === "formal" },
  { id: "casual", label: "Casual", test: (item) => item.formality === "casual" },
  { id: "neutrals", label: "Neutrals", test: (item) => isNeutral(item.color) },
];
const GROUP_MAP = Object.fromEntries(GROUPS.map((group) => [group.id, group]));
const SEASON_LABELS = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };
const needsSorting = (item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality;

const SORTS = [
  { id: "category", label: "Category" },
  { id: "recent", label: "Recently added" },
  { id: "color", label: "Color" },
  { id: "name", label: "Name" },
];

function GalleryItem({ item, selected, onOpen, index }) {
  const type = t(TYPE_MAP[item.part]?.singular || t("Wardrobe item"));
  const swatches = [item.color, item.secondaryColor].filter(Boolean);

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`${t("View")} ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
      style={{ "--stagger": `${Math.min(index, 18) * 18}ms` }}
    >
      <span className="gallery-item__media">
        <OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 24px), (max-width: 860px) calc(33vw - 24px), 220px"
          breakpoints={[160, 240, 320, 480, 640]}
        />
      </span>
      <span className="gallery-item__meta">
        <span className="gallery-item__name">{item.name || type}</span>
        <span className="gallery-item__sub">
          <span className="gallery-item__type">{type}</span>
          {!!swatches.length && (
            <span className="gallery-item__swatches" aria-hidden="true">
              {swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function TagEditor({ tags, onChange }) {
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

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
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
      <div className="palette" aria-label={`${label} suggestions from image`}>
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

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
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
          <input value={draft.kind || ""} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))} placeholder="sweater" maxLength={30} />
        </label>
        <label className="field">
          <span>{t("Warmth")}</span>
          <select value={draft.warmth || ""} onChange={(event) => setDraft((current) => ({ ...current, warmth: event.target.value ? Number(event.target.value) : "" }))}>
            <option value="">{t("Not set")}</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {["very light", "light", "medium", "warm", "very warm"][value - 1]}</option>)}
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

function WearStats({ item }) {
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

function ItemViewer({ item, onClose, onSave, onDelete, onWear, onPicture }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", seasons: [...(item.seasons || [])] });
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
      kind: draft.kind.trim().toLowerCase(), warmth: draft.warmth || null, formality: draft.formality || null, seasons: [...draft.seasons].sort(),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
      price: item.price ?? null,
      kind: item.kind || "", warmth: item.warmth || null, formality: item.formality || null, seasons: [...(item.seasons || [])].sort(),
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
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", seasons: [...(item.seasons || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], price: item.price ?? "", kind: item.kind || "", warmth: item.warmth || "", formality: item.formality || "", seasons: [...(item.seasons || [])] });
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = async () => {
    setSampling(null);
    try {
      await onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean), price: draft.price === "" ? null : Number(draft.price), kind: draft.kind.trim().toLowerCase() || null, warmth: draft.warmth || null, formality: draft.formality || null, seasons: draft.seasons });
      setSampleStatus("Changes saved.");
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
      setSampleStatus("That spot is see-through. Tap right on the garment.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Sampled ${color} as the ${sampling} color.`);
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
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label={t("Selected wardrobe item")}>
      <span className="sheet-grabber" aria-hidden="true" />
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
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || t(TYPE_MAP[draft.part]?.singular || t("Wardrobe item"))}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
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
        {onPicture && <PictureTools item={item} onSaved={onPicture} />}
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />

        {closeBlocked && <p className="unsaved-notice" role="status">{t("Save or cancel changes before closing.")}</p>}

        <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> {t("Delete")}
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>{t("Cancel")}</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> {t("Save")}
          </button>
        </div>
      </div>
    </aside>
    </div>
    </div>
  );
}

export function App() {
  const [connectReason, setConnectReason] = useState(() => needsServerUrl() ? "setup" : null);

  useEffect(() => {
    const onAuthRequired = () => setConnectReason("token");
    window.addEventListener(AUTH_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_EVENT, onAuthRequired);
  }, []);

  const onConnectionFailed = useCallback(() => setConnectReason("unreachable"), []);

  if (connectReason) return <ConnectScreen reason={connectReason} />;
  return <Wardrobe onConnectionFailed={onConnectionFailed} />;
}

function Wardrobe({ onConnectionFailed }) {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("closet");
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState(null);
  const [sort, setSort] = useState(() => {
    try { return localStorage.getItem("wardrobe-sort") || "category"; } catch { return "category"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outfits, setOutfits] = useState(null);
  const [outfitsError, setOutfitsError] = useState("");
  const [openOutfitId, setOpenOutfitId] = useState(null);
  const [group, setGroup] = useState(null);
  const [sorting, setSorting] = useState(false);
  const { plan, save: savePlan, error: planError } = usePlan();
  const setup = useAiSetup();
  const weather = useWeather();
  const [starterOpen, setStarterOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("wardrobe-sort", sort); } catch { /* storage unavailable */ }
  }, [sort]);

  useEffect(() => {
    const timer = setInterval(ensureImageKey, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    ensureImageKey()
      .then(() => apiFetch("/api/import/wardrobe", { cache: "no-store" }))
      .then((response) => {
        if (!response.ok) throw new Error(t("Could not load the wardrobe."));
        return response.json();
      })
      .then(async (loadedItems) => {
        const legacyEdits = takeLegacyEdits();
        const migrated = await Promise.all(loadedItems.map(async (item) => {
          const edit = legacyEdits[item.id];
          if (!edit) return item;
          try { return await saveItemToServer(item.id, edit); }
          catch { return { ...item, ...edit }; }
        }));
        setItems(migrated);
      })
      .catch((requestError) => {
        if (isNativeApp() && requestError instanceof TypeError) onConnectionFailed();
        else setError(requestError.message);
      })
      .finally(() => setLoading(false));
  }, [onConnectionFailed]);

  useEffect(() => {
    ensureImageKey()
      .then(() => apiFetch("/api/import/outfits", { cache: "no-store" }))
      .then((response) => {
        if (!response.ok) throw new Error(t("Could not load outfits."));
        return response.json();
      })
      .then(setOutfits)
      .catch((requestError) => setOutfitsError(requestError.message));
  }, []);

  const mergeItems = useCallback((saved) => {
    const byId = new Map(saved.filter(Boolean).map((item) => [item.id, item]));
    setItems((current) => current.map((item) => byId.get(item.id) || item));
  }, []);

  const onWorn = useCallback(({ outfit, pieces }) => {
    setOutfits((current) => (current || []).map((entry) => (entry.id === outfit.id ? outfit : entry)));
    mergeItems(pieces);
  }, [mergeItems]);

  const wearItem = async (id, undo) => {
    try { mergeItems([await wearPiece(id, { day: dayString(), undo })]); }
    catch (requestError) { setError(requestError.message); }
  };

  const openOutfit = (id) => { setOpenOutfitId(id); setView("outfits"); setSelectedId(null); };
  const browsingAll = activeType === "all" && !query && !colorFilter && !group;
  const showingPlan = view === "plan";
  const groupsInCloset = useMemo(() => GROUPS.filter((entry) => items.some(entry.test)), [items]);
  const unsorted = useMemo(() => items.filter(needsSorting).length, [items]);

  const sortCloset = async () => {
    if (!(await askAiConsent(setup))) return;
    setSorting(true); setError("");
    try { mergeItems((await sendJson("/api/import/wardrobe/sort", "POST", {}, "Could not sort your closet.")).items || []); }
    catch (requestError) { setError(requestError.message); }
    finally { setSorting(false); }
  };

  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const showingOutfits = view === "outfits";

  const counts = useMemo(() => {
    const result = { all: items.length };
    for (const item of items) result[item.part] = (result[item.part] || 0) + 1;
    return result;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (activeType !== "all" && item.part !== activeType) return false;
      if (colorFilter && !itemFamilies(item).includes(colorFilter)) return false;
      if (group && !GROUP_MAP[group]?.test(item)) return false;
      if (!needle) return true;
      const haystack = [item.name, item.kind, item.formality, ...(item.seasons || []), TYPE_MAP[item.part]?.label, TYPE_MAP[item.part]?.singular, ...itemFamilies(item), ...(item.tags || [])]
        .filter(Boolean).join(" ").toLowerCase();
      return needle.split(/\s+/).every((word) => haystack.includes(word));
    });
    const order = items.map((item) => item.id);
    return [...filtered].sort((a, b) => {
      if (sort === "recent") {
        const byDate = (b.addedAt || "").localeCompare(a.addedAt || "");
        return byDate || order.indexOf(b.id) - order.indexOf(a.id);
      }
      if (sort === "name") return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      if (sort === "color") return colorSortKey(a) - colorSortKey(b);
      const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
      return typeDifference || a.id.localeCompare(b.id);
    });
  }, [activeType, colorFilter, group, items, query, sort]);

  const familiesInCloset = useMemo(() => {
    const present = new Set(items.flatMap(itemFamilies));
    return COLOR_FAMILIES.filter((family) => present.has(family.id));
  }, [items]);

  // Clear a color filter that no longer matches anything, e.g. after a delete.
  useEffect(() => {
    if (colorFilter && !familiesInCloset.some((family) => family.id === colorFilter)) setColorFilter(null);
  }, [colorFilter, familiesInCloset]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const saveItem = async (updatedItem) => {
    const saved = await saveItemToServer(updatedItem.id, {
      name: updatedItem.name,
      part: updatedItem.part,
      color: updatedItem.color,
      secondaryColor: updatedItem.secondaryColor || null,
      tags: updatedItem.tags,
      price: updatedItem.price ?? null,
      kind: updatedItem.kind ?? null,
      warmth: updatedItem.warmth ?? null,
      formality: updatedItem.formality ?? null,
      seasons: Array.isArray(updatedItem.seasons) && updatedItem.seasons.length ? updatedItem.seasons : null,
    });
    setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
  };

  const deleteItem = async (id) => {
    try {
      const response = await apiFetch(`/api/import/wardrobe/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(t("Could not delete the item."));
    } catch (requestError) {
      setError(requestError.message);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
  };

  const addImportedItem = useCallback((newItem) => {
    if (!newItem) return;
    setItems((current) => current.some((item) => item.id === newItem.id) ? current : [...current, newItem]);
  }, []);

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        <header className="topbar">
          <div className="topbar__row">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><CoatHanger size={20} weight="bold" /></span>
              <div className="brand__text">
                <h1>{t("Wardrobe")}</h1>
                <p className="piece-count">{tn(items.length, "{n} piece", "{n} pieces")}</p>
              </div>
            </div>

            <div className="view-switch" role="tablist" aria-label={t("Choose a view")}>
              {[{ id: "closet", label: "Closet", Icon: CoatHanger }, { id: "outfits", label: "Outfits", Icon: Sparkle }, { id: "plan", label: "Plan", Icon: CalendarBlank }].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  className={view === id ? "active" : ""}
                  onClick={() => { setView(id); setSelectedId(null); }}
                >
                  <Icon size={16} weight={view === id ? "fill" : "regular"} aria-hidden="true" />
                  <span>{t(label)}</span>
                </button>
              ))}
            </div>

            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label={t("Settings and connection")}>
              <GearSix size={20} aria-hidden="true" />
            </button>
          </div>

          {!showingOutfits && !showingPlan && (
            <>
              <div className="toolbar">
                <label className="search">
                  <MagnifyingGlass size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Search name, color, or detail")}
                    aria-label={t("Search your wardrobe")}
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </label>
                <label className="sort-select">
                  <ArrowsDownUp size={16} aria-hidden="true" />
                  <span className="visually-hidden">{t("Sort by")}</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value)}>
                    {SORTS.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
                  </select>
                </label>
              </div>

              <nav className="category-nav" aria-label={t("Filter wardrobe by item type")}>
                {TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={activeType === type.id ? "active" : ""}
                    onClick={() => chooseType(type.id)}
                    aria-pressed={activeType === type.id}
                  >
                    {t(type.label)}
                    <span className="chip-count">{counts[type.id] || 0}</span>
                  </button>
                ))}
              </nav>

              {familiesInCloset.length > 1 && (
                <div className="color-filter" role="group" aria-label={t("Filter by color")}>
                  {familiesInCloset.map((family) => (
                    <button
                      key={family.id}
                      type="button"
                      className={colorFilter === family.id ? "active" : ""}
                      aria-pressed={colorFilter === family.id}
                      title={t(family.label)}
                      onClick={() => setColorFilter((current) => (current === family.id ? null : family.id))}
                    >
                      <span style={{ backgroundColor: family.swatch }} aria-hidden="true" />
                      <span className="visually-hidden">{t(family.label)}</span>
                    </button>
                  ))}
                  {colorFilter && (
                    <button type="button" className="color-filter__clear" onClick={() => setColorFilter(null)}>
                      {t(COLOR_FAMILIES.find((family) => family.id === colorFilter)?.label || "")} <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {(groupsInCloset.length > 0 || (unsorted > 0 && setup?.ready)) && (
                <div className="group-filter" role="group" aria-label={t("Smart groups")}>
                  {groupsInCloset.map((entry) => (
                    <button key={entry.id} type="button" className={group === entry.id ? "active" : ""} aria-pressed={group === entry.id} onClick={() => setGroup((current) => (current === entry.id ? null : entry.id))}>
                      {t(entry.label)} <span className="chip-count">{items.filter(entry.test).length}</span>
                    </button>
                  ))}
                  {unsorted > 0 && setup?.ready && (
                    <button type="button" className="group-filter__sort" onClick={sortCloset} disabled={sorting}>
                      {sorting ? <SpinnerGap size={14} className="import-spinner" aria-hidden="true" /> : <MagicWand size={14} aria-hidden="true" />}
                      {sorting ? t("Sorting") : tn(unsorted, "Sort {n} piece for me", "Sort {n} pieces for me")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </header>

        {error && <p className="status error">{error}</p>}
        {showingOutfits && (
          <OutfitGallery
            items={items}
            outfits={outfits}
            setOutfits={setOutfits}
            loadError={outfitsError}
            onWorn={onWorn}
            openId={openOutfitId}
            setOpenId={setOpenOutfitId}
            onSelectGarment={setSelectedId}
          />
        )}

        {showingPlan && (
          <PlanView items={items} outfits={outfits} plan={plan} savePlan={savePlan} forecast={weather.forecast} planError={planError || outfitsError} onGoToOutfits={() => setView("outfits")} />
        )}

        {!showingOutfits && !showingPlan && !loading && !error && browsingAll && !!items.length && (
          <div className="closet-highlights">
            {!!outfits?.length && <TodayCard items={items} outfits={outfits} plan={plan} weather={weather.today} onWorn={onWorn} onOpenOutfit={openOutfit} />}
            <ForgottenRow items={items} onOpen={setSelectedId} />
          </div>
        )}

        {!showingOutfits && !showingPlan && !error && loading && (
          <section className="gallery-grid" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => <span className="gallery-skeleton" key={index} />)}
          </section>
        )}

        {!showingOutfits && !showingPlan && !error && !loading && !items.length && (
          <div className="empty-state">
            <span className="empty-state__icon" aria-hidden="true"><CoatHanger size={34} weight="light" /></span>
            <h2>{t("Your closet is empty")}</h2>
            <p>{t("Add a photo of one piece or a whole outfit. Each piece is cut out and added here.")}</p>
            <p className="empty-state__hint"><Plus size={14} aria-hidden="true" /> {t("Tap Add clothes to start.")}</p>
            <button className="secondary-button" type="button" onClick={() => setStarterOpen(true)}><TShirt size={16} aria-hidden="true" /> {t("Add basics without a photo")}</button>
          </div>
        )}

        {!showingOutfits && !showingPlan && !!items.length && !visibleItems.length && (
          <div className="empty-state compact">
            <h2>{query || colorFilter || group ? t("No matches") : t("No {type} yet", { type: activeType === "all" ? t("pieces") : t(TYPE_MAP[activeType]?.label || t("All")).toLowerCase() })}</h2>
            <p>{query || colorFilter || group ? t("Nothing in {where} matches these filters.", { where: activeType === "all" ? t("your closet") : t(TYPE_MAP[activeType]?.label || t("All")).toLowerCase() }) : t("Add a photo and it will show up here.")}</p>
            <button className="secondary-button" type="button" onClick={() => { setQuery(""); setColorFilter(null); setGroup(null); chooseType("all"); }}>{t("Clear filters")}</button>
          </div>
        )}

        {!showingOutfits && !showingPlan && !!visibleItems.length && (
          <section className="gallery-grid" aria-label={t(TYPE_MAP[activeType]?.label || t("All"))}>
            {visibleItems.map((item, index) => (
              <GalleryItem
                key={item.id}
                item={item}
                index={index}
                selected={selectedId === item.id}
                onOpen={setSelectedId}
              />
            ))}
          </section>
        )}
      </main>

      {selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} onWear={wearItem} onPicture={(saved) => setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry))} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} pieces={items.length} weather={weather} onStarter={() => { setSettingsOpen(false); setStarterOpen(true); }} />}
      <WardrobeImportFlow onGarmentApproved={addImportedItem} onStarter={() => setStarterOpen(true)} />
      {starterOpen && <StarterPicker onClose={() => setStarterOpen(false)} onAdded={addImportedItem} />}
      <AiConsentPrompt />
    </div>
  );
}
