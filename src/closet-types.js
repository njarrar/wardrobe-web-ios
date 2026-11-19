// The closet's categories, smart groups and sort orders.
import { isModestWear } from "../shared/pairing.mjs";
import { itemWarmth } from "../shared/style.mjs";
import { isNeutral } from "../shared/style.mjs";

export const TYPES = [
  { id: "all", label: "All" },
  { id: "upperbody", label: "Tops", singular: "Top" },
  { id: "wholebody_up", label: "Jackets", singular: "Jacket" },
  { id: "lowerbody", label: "Bottoms", singular: "Bottom" },
  { id: "accessories_up", label: "Accessories", singular: "Accessory" },
  { id: "shoes", label: "Shoes", singular: "Shoes" },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
export const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

// Smart groups built from what the AI (or you) said about each piece.
export const GROUPS = [
  { id: "winter", label: "Winter", test: (item) => item.seasons?.includes("winter") || (!item.seasons && itemWarmth(item) >= 4) },
  { id: "summer", label: "Summer", test: (item) => item.seasons?.includes("summer") || (!item.seasons && itemWarmth(item) <= 2) },
  { id: "spring-fall", label: "Spring and fall", test: (item) => item.seasons?.includes("spring") || item.seasons?.includes("fall") },
  { id: "work", label: "Work", test: (item) => item.formality === "smart" || item.formality === "formal" },
  { id: "casual", label: "Casual", test: (item) => item.formality === "casual" },
  { id: "neutrals", label: "Neutrals", test: (item) => isNeutral(item.color) },
  { id: "modest", label: "Modest wear", test: isModestWear },
];
export const GROUP_MAP = Object.fromEntries(GROUPS.map((group) => [group.id, group]));
export const SEASON_LABELS = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };
export const needsSorting = (item) => !item.kind || !Array.isArray(item.seasons) || !item.warmth || !item.formality;

export const SORTS = [
  { id: "category", label: "Category" },
  { id: "recent", label: "Recently added" },
  { id: "color", label: "Color" },
  { id: "name", label: "Name" },
];
