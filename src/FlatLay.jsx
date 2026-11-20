import { ArrowsLeftRight, Lock, LockOpen } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { isOnePiece } from "../shared/core.mjs";
import { t } from "./i18n.js";
import "./flatlay.css";

// Anatomical flat-lay outfit canvas: places jacket, top/one-piece, bottom,
// shoes and accessory where they sit on the body instead of a uniform grid.
// Used on Home, Outfit cards, Outfit detail and Build-Your-Own preview.

function assignSlots(pieces = []) {
  const taken = new Set();
  const pick = (test) => {
    const found = pieces.find((item) => !taken.has(item.id) && test(item));
    if (found) taken.add(found.id);
    return found || null;
  };
  const onePiece = pick((item) => item.part === "upperbody" && isOnePiece(item));
  const top = onePiece ? null : pick((item) => item.part === "upperbody");
  const bottom = pick((item) => item.part === "lowerbody");
  const layer = pick((item) => item.part === "wholebody_up");
  const shoes = pick((item) => item.part === "shoes");
  const accessory = pick((item) => item.part === "accessories_up");
  const extra = pieces.filter((item) => !taken.has(item.id));

  const slots = [];
  if (layer) slots.push({ item: layer, slot: "layer" });
  if (onePiece) slots.push({ item: onePiece, slot: "onepiece" });
  if (top) slots.push({ item: top, slot: "top" });
  if (bottom) slots.push({ item: bottom, slot: "bottom" });
  if (accessory) slots.push({ item: accessory, slot: "accessory" });
  if (shoes) slots.push({ item: shoes, slot: "shoes" });
  for (const item of extra) slots.push({ item, slot: "extra" });
  return {
    slots,
    hasLayer: Boolean(layer),
    hasOnePiece: Boolean(onePiece),
    hasBottom: Boolean(bottom),
    hasAccessory: Boolean(accessory),
    hasShoes: Boolean(shoes),
  };
}

export function FlatLay({
  pieces = [],
  variant = "hero",
  lockedIds = [],
  swappingId = null,
  canLock = false,
  canSwap = false,
  onOpenPiece = null,
  onToggleLock = null,
  onStartSwap = null,
}) {
  const { slots, hasLayer, hasOnePiece, hasBottom, hasAccessory, hasShoes } = assignSlots(pieces);
  const interactive = Boolean(onOpenPiece);
  const classes = [
    "flat-lay",
    `flat-lay--${variant}`,
    `flat-lay--count-${Math.min(slots.length, 5)}`,
    hasLayer && "has-layer",
    hasOnePiece && "has-onepiece",
    hasBottom && "has-bottom",
    hasAccessory && "has-accessory",
    hasShoes && "has-shoes",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} aria-hidden={interactive ? undefined : true}>
      {slots.map(({ item, slot }) => {
        const locked = lockedIds.includes(item.id);
        const swapping = swappingId === item.id;
        return (
          <div
            className={`flat-lay__piece flat-lay__piece--${item.part} flat-lay__slot--${slot}${locked ? " is-locked" : ""}${swapping ? " is-swapping" : ""}`}
            key={item.id}
          >
            {interactive ? (
              <button
                type="button"
                className="flat-lay__open"
                onClick={() => onOpenPiece(item.id)}
                aria-label={item.name || t("Piece")}
              >
                <img src={assetUrl(item.image || item.thumbnail)} alt="" loading={variant === "card" ? "lazy" : undefined} />
              </button>
            ) : (
              <span className="flat-lay__open">
                <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
              </span>
            )}
            {canLock && onToggleLock && (
              <button
                type="button"
                className="flat-lay__lock"
                aria-pressed={locked}
                aria-label={locked ? t("Let {name} change", { name: item.name }) : t("Keep {name}", { name: item.name })}
                onClick={() => onToggleLock(item.id)}
              >
                {locked ? <Lock size={14} weight="fill" aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
              </button>
            )}
            {canSwap && onStartSwap && (
              <button
                type="button"
                className={`flat-lay__swap${swapping ? " is-active" : ""}`}
                aria-pressed={swapping}
                aria-label={t("Swap {name}", { name: item.name })}
                onClick={() => onStartSwap(item.id)}
              >
                <ArrowsLeftRight size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
