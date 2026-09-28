import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, Check, CoatHanger, GearSix, MagnifyingGlass, Plus, Sparkle, Trash, X } from "@phosphor-icons/react";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitGallery } from "./Outfits.jsx";
import { ConnectScreen } from "./ConnectScreen.jsx";
import { SettingsSheet } from "./SettingsSheet.jsx";
import { AUTH_EVENT, apiFetch, isNativeApp, needsServerUrl } from "./api.js";

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

const SORTS = [
  { id: "category", label: "Category" },
  { id: "recent", label: "Recently added" },
  { id: "color", label: "Color" },
  { id: "name", label: "Name" },
];

function GalleryItem({ item, selected, onOpen, index }) {
  const type = TYPE_MAP[item.part]?.singular || "wardrobe item";
  const swatches = [item.color, item.secondaryColor].filter(Boolean);

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`View ${item.name || type}`}
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
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`Remove ${tag}`}>
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
          placeholder="Add a detail"
          aria-label="Add detail tag"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="Add detail">
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
          <span>{label}</span>
          <small>Optional</small>
        </div>
        <p>No distinct secondary color detected.</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>Add secondary color</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>Remove</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Choose ${label.toLowerCase()}`}
        />
        <span className="selected-color-copy">
          <small>Selected</small>
          <strong>{value || "Custom"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>Image suggestions</span>
        <small>Click to apply</small>
      </div>
      <div className="palette" aria-label={`${label} suggestions from image`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`Use ${color} as ${label.toLowerCase()}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "Cancel picking" : `Pick ${label.toLowerCase()} from image`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "Wardrobe item"}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      <fieldset className="color-field">
        <legend>Colors</legend>
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
        <p className="color-help" aria-live="polite">{sampling ? `Click anywhere on the garment to sample the ${sampling} color.` : sampleStatus || "Primary colors come from the image. A secondary is suggested only when a distinct color has meaningful coverage."}</p>
      </fieldset>

      <div className="field details-field">
        <span>Details</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

function ItemViewer({ item, onClose, onSave, onDelete }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const type = TYPE_MAP[item.part]?.singular || "Wardrobe item";
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
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
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
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = async () => {
    setSampling(null);
    try {
      await onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
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
      setSampleStatus("That spot is transparent—try directly on the garment.");
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
        alt={`Selected ${type.toLowerCase()}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">Click garment to sample</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Selected wardrobe item">
      <span className="sheet-grabber" aria-hidden="true" />
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Close viewer" ref={closeButtonRef}>
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
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />

        {closeBlocked && <p className="unsaved-notice" role="status">Save or cancel changes before closing.</p>}

        <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> Delete
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>Cancel</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> Save
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

  useEffect(() => {
    try { localStorage.setItem("wardrobe-sort", sort); } catch { /* storage unavailable */ }
  }, [sort]);

  useEffect(() => {
    apiFetch("/api/import/wardrobe", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the wardrobe.");
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
      if (!needle) return true;
      const haystack = [item.name, TYPE_MAP[item.part]?.label, TYPE_MAP[item.part]?.singular, ...itemFamilies(item), ...(item.tags || [])]
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
  }, [activeType, colorFilter, items, query, sort]);

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
    });
    setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
  };

  const deleteItem = async (id) => {
    try {
      const response = await apiFetch(`/api/import/wardrobe/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete the item.");
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
                <h1>Wardrobe</h1>
                <p className="piece-count">{items.length} {items.length === 1 ? "piece" : "pieces"}</p>
              </div>
            </div>

            <div className="view-switch" role="tablist" aria-label="Choose a view">
              {[{ id: "closet", label: "Closet", Icon: CoatHanger }, { id: "outfits", label: "Outfits", Icon: Sparkle }].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  className={view === id ? "active" : ""}
                  onClick={() => { setView(id); setSelectedId(null); }}
                >
                  <Icon size={16} weight={view === id ? "fill" : "regular"} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings and connection">
              <GearSix size={20} aria-hidden="true" />
            </button>
          </div>

          {!showingOutfits && (
            <>
              <div className="toolbar">
                <label className="search">
                  <MagnifyingGlass size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, color, or detail"
                    aria-label="Search your wardrobe"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </label>
                <label className="sort-select">
                  <ArrowsDownUp size={16} aria-hidden="true" />
                  <span className="visually-hidden">Sort by</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value)}>
                    {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <nav className="category-nav" aria-label="Filter wardrobe by item type">
                {TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={activeType === type.id ? "active" : ""}
                    onClick={() => chooseType(type.id)}
                    aria-pressed={activeType === type.id}
                  >
                    {type.label}
                    <span className="chip-count">{counts[type.id] || 0}</span>
                  </button>
                ))}
              </nav>

              {familiesInCloset.length > 1 && (
                <div className="color-filter" role="group" aria-label="Filter by color">
                  {familiesInCloset.map((family) => (
                    <button
                      key={family.id}
                      type="button"
                      className={colorFilter === family.id ? "active" : ""}
                      aria-pressed={colorFilter === family.id}
                      title={family.label}
                      onClick={() => setColorFilter((current) => (current === family.id ? null : family.id))}
                    >
                      <span style={{ backgroundColor: family.swatch }} aria-hidden="true" />
                      <span className="visually-hidden">{family.label}</span>
                    </button>
                  ))}
                  {colorFilter && (
                    <button type="button" className="color-filter__clear" onClick={() => setColorFilter(null)}>
                      {COLOR_FAMILIES.find((family) => family.id === colorFilter)?.label} <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </header>

        {error && <p className="status error">{error}</p>}
        {showingOutfits && <OutfitGallery items={items} onSelectGarment={setSelectedId} />}

        {!showingOutfits && !error && loading && (
          <section className="gallery-grid" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => <span className="gallery-skeleton" key={index} />)}
          </section>
        )}

        {!showingOutfits && !error && !loading && !items.length && (
          <div className="empty-state">
            <span className="empty-state__icon" aria-hidden="true"><CoatHanger size={34} weight="light" /></span>
            <h2>Your closet is empty</h2>
            <p>Drop, paste, or snap a photo of a piece — or a whole outfit — and it will be cut out and added here.</p>
            <p className="empty-state__hint"><Plus size={14} aria-hidden="true" /> Use the add button in the corner to start.</p>
          </div>
        )}

        {!showingOutfits && !!items.length && !visibleItems.length && (
          <div className="empty-state compact">
            <h2>{query || colorFilter ? "No matches" : `No ${TYPE_MAP[activeType]?.label.toLowerCase() || "pieces"} yet`}</h2>
            <p>{query || colorFilter ? `Nothing in ${TYPE_MAP[activeType]?.label.toLowerCase() || "your closet"} matches these filters.` : "Add a photo and it will show up here."}</p>
            <button className="secondary-button" type="button" onClick={() => { setQuery(""); setColorFilter(null); chooseType("all"); }}>Clear filters</button>
          </div>
        )}

        {!showingOutfits && !!visibleItems.length && (
          <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "All"} wardrobe items`}>
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

      {selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} pieces={items.length} />}
      <WardrobeImportFlow onGarmentApproved={addImportedItem} />
    </div>
  );
}
