import { OptimizedImage } from "./OptimizedImage.jsx";
import { tileNote } from "../shared/pairing.mjs";
import { wearCount } from "../shared/style.mjs";
import { t, tn } from "./i18n.js";
import { TYPE_MAP } from "./closet-types.js";

// One piece's tile in the closet grid.
export function GalleryItem({ item, selected, onOpen, index }) {
  const type = t(TYPE_MAP[item.part]?.singular || t("Wardrobe item"));
  const swatches = [item.color, item.secondaryColor].filter(Boolean);
  const worn = wearCount(item);
  const note = tileNote(item);

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
        {worn > 0 && <span className="gallery-item__worn" title={tn(worn, "Worn {n} time", "Worn {n} times")}>{worn}×</span>}
      </span>
      <span className="gallery-item__meta">
        <span className="gallery-item__name">{item.name || type}</span>
        <span className="gallery-item__sub">
          <span className="gallery-item__type">{note ? t(note) : type}</span>
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
