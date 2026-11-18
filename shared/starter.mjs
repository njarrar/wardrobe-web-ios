// Basics you can add without a photo. Each is drawn from shared/shapes.mjs in
// the color you pick, then saved like any other piece.

export const STARTER_COLORS = [
  { id: "white", label: "White", hex: "#f3f1ec" },
  { id: "black", label: "Black", hex: "#222222" },
  { id: "grey", label: "Grey", hex: "#9a9893" },
  { id: "navy", label: "Navy", hex: "#2c3e66" },
  { id: "blue", label: "Blue", hex: "#3f67a8" },
  { id: "beige", label: "Beige", hex: "#c9b996" },
  { id: "brown", label: "Brown", hex: "#6e4428" },
  { id: "olive", label: "Olive", hex: "#5f6b3f" },
  { id: "green", label: "Green", hex: "#3f7a52" },
  { id: "burgundy", label: "Burgundy", hex: "#6e2530" },
  { id: "rust", label: "Rust", hex: "#a9502f" },
  { id: "pink", label: "Pink", hex: "#e3a5b6" },
];

// [id, name, part, shape, default color id, tags]
const BASICS = [
  ["tee", "T-shirt", "upperbody", "tee", "white", ["cotton", "casual"]],
  ["striped-tee", "Striped tee", "upperbody", "stripedTee", "navy", ["casual"]],
  ["oxford", "Oxford shirt", "upperbody", "shirt", "white", ["cotton", "smart"]],
  ["dress-shirt", "Dress shirt", "upperbody", "shirt", "blue", ["smart"]],
  ["sweater", "Crew sweater", "upperbody", "sweater", "grey", ["wool", "warm"]],
  ["hoodie", "Hoodie", "upperbody", "sweater", "black", ["cotton", "casual"]],
  ["jacket", "Casual jacket", "wholebody_up", "jacket", "olive", ["cotton"]],
  ["blazer", "Blazer", "wholebody_up", "jacket", "navy", ["smart"]],
  ["coat", "Wool coat", "wholebody_up", "coat", "beige", ["wool", "warm"]],
  ["trench", "Trench coat", "wholebody_up", "coat", "beige", ["rain", "smart"]],
  ["jeans", "Jeans", "lowerbody", "jeans", "navy", ["denim"]],
  ["chinos", "Chinos", "lowerbody", "trousers", "beige", ["cotton", "smart casual"]],
  ["trousers", "Smart trousers", "lowerbody", "trousers", "black", ["smart"]],
  ["sweatpants", "Joggers", "lowerbody", "trousers", "grey", ["casual"]],
  ["sneakers", "Sneakers", "shoes", "sneakers", "white", ["leather"]],
  ["loafers", "Loafers", "shoes", "loafers", "brown", ["leather", "smart"]],
  ["boots", "Boots", "shoes", "boots", "black", ["leather"]],
  ["tote", "Tote bag", "accessories_up", "tote", "beige", ["canvas"]],
  ["scarf", "Scarf", "accessories_up", "scarf", "rust", ["wool", "warm"]],
];

// Kind, seasons, warmth and dress level for each starter piece.
const SORT_DEFAULTS = {
  tee: { kind: "tee", seasons: ["spring", "summer"], warmth: 1, formality: "casual" },
  "striped-tee": { kind: "tee", seasons: ["spring", "summer"], warmth: 2, formality: "casual" },
  oxford: { kind: "shirt", seasons: ["spring", "summer", "fall"], warmth: 2, formality: "smart" },
  "dress-shirt": { kind: "shirt", seasons: ["spring", "summer", "fall", "winter"], warmth: 2, formality: "formal" },
  sweater: { kind: "sweater", seasons: ["fall", "winter"], warmth: 4, formality: "smart" },
  hoodie: { kind: "hoodie", seasons: ["fall", "winter", "spring"], warmth: 3, formality: "casual" },
  jacket: { kind: "jacket", seasons: ["spring", "fall"], warmth: 3, formality: "casual" },
  blazer: { kind: "blazer", seasons: ["spring", "fall", "winter"], warmth: 3, formality: "formal" },
  coat: { kind: "coat", seasons: ["winter"], warmth: 5, formality: "smart" },
  trench: { kind: "coat", seasons: ["spring", "fall"], warmth: 4, formality: "smart" },
  jeans: { kind: "jeans", seasons: ["spring", "fall", "winter"], warmth: 3, formality: "casual" },
  chinos: { kind: "chinos", seasons: ["spring", "summer", "fall"], warmth: 2, formality: "smart" },
  trousers: { kind: "trousers", seasons: ["spring", "fall", "winter"], warmth: 3, formality: "formal" },
  sweatpants: { kind: "joggers", seasons: ["fall", "winter", "spring"], warmth: 3, formality: "casual" },
  sneakers: { kind: "sneakers", seasons: ["spring", "summer", "fall"], warmth: 2, formality: "casual" },
  loafers: { kind: "loafers", seasons: ["spring", "summer", "fall"], warmth: 2, formality: "smart" },
  boots: { kind: "boots", seasons: ["fall", "winter"], warmth: 4, formality: "smart" },
  tote: { kind: "bag", seasons: ["spring", "summer", "fall", "winter"], warmth: 1, formality: "casual" },
  scarf: { kind: "scarf", seasons: ["fall", "winter"], warmth: 4, formality: "casual" },
};

export const STARTER_PIECES = BASICS.map(([id, name, part, shape, color, tags]) => ({
  id, name, part, shape, color: STARTER_COLORS.find((entry) => entry.id === color).hex, tags, ...SORT_DEFAULTS[id],
}));
