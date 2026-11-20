import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, CalendarBlank, Camera, ChartBar, CoatHanger, GearSix, House, MagicWand, MagnifyingGlass, Plus, SlidersHorizontal, Sparkle, SpinnerGap, TShirt, X } from "@phosphor-icons/react";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OutfitGallery } from "./Outfits.jsx";
import { ConnectScreen } from "./ConnectScreen.jsx";
import { GalleryItem } from "./ClosetGrid.jsx";
import { ItemViewer } from "./ItemViewer.jsx";
import { AiConsentPrompt } from "./AiConsentPrompt.jsx";
import { AUTH_EVENT, apiFetch, ensureImageKey, isNativeApp, needsServerUrl } from "./api.js";
import { CLOSET_CHANGED_EVENT } from "./local/mode.js";
import { ForgottenRow } from "./Today.jsx";
import { ADD_CLOTHES_EVENT, HomeView } from "./Home.jsx";
import { canMakeOutfit } from "../shared/make-outfit.mjs";
import { PlanView, usePlan } from "./Plan.jsx";
import { PATTERN_LABELS, tileNote } from "../shared/pairing.mjs";
import { useWeather } from "./weather.js";
import { askAiConsent, useAiSetup } from "./ai-setup.js";
import { sendJson, wearPiece } from "./wear.js";
import { dayString, wearCount } from "../shared/style.mjs";
import { isRtl, t, tn, useLanguage } from "./i18n.js";
import { handleRovingKeys } from "./dialog.js";
import {
  COLOR_FAMILIES, COLOR_FAMILY_MAP, DRESS_LABELS, GROUP_MAP, GROUPS, SEASON_LABELS, SORTS,
  TYPE_MAP, TYPE_ORDER, TYPES, colorSortKey, itemFamilies, needsSorting, normalizeSearchText, pieceLabel,
} from "./color-utils.js";

// Screens most visits never open are fetched when first needed, so the
// app's first load is smaller.
const SettingsSheet = lazy(() => import("./SettingsSheet.jsx").then((module) => ({ default: module.SettingsSheet })));
const InsightsSheet = lazy(() => import("./InsightsSheet.jsx").then((module) => ({ default: module.InsightsSheet })));
const StarterPicker = lazy(() => import("./StarterPicker.jsx").then((module) => ({ default: module.StarterPicker })));

const LEGACY_EDITS_KEY = "open-wardrobe-edits-v1";
const LEGACY_DELETED_KEY = "open-wardrobe-deleted-v1";

const MAIN_TABS = [
  { id: "home", label: "Home", Icon: House },
  { id: "closet", label: "Closet", Icon: CoatHanger },
  { id: "outfits", label: "Outfits", Icon: Sparkle },
  { id: "plan", label: "Plan", Icon: CalendarBlank },
];

// Older versions kept edits in this browser only. Read them without deleting
// upfront so failed PATCHes are not lost (#109).
function readLegacyEdits() {
  try {
    const edits = JSON.parse(localStorage.getItem(LEGACY_EDITS_KEY) || "{}");
    return edits && typeof edits === "object" ? edits : {};
  } catch {
    return {};
  }
}

function removeLegacyEditId(id) {
  try {
    const edits = readLegacyEdits();
    if (!(id in edits)) return;
    delete edits[id];
    if (Object.keys(edits).length) localStorage.setItem(LEGACY_EDITS_KEY, JSON.stringify(edits));
    else {
      localStorage.removeItem(LEGACY_EDITS_KEY);
      localStorage.removeItem(LEGACY_DELETED_KEY);
    }
  } catch { /* storage unavailable */ }
}

async function saveItemToServer(id, changes) {
  const response = await apiFetch(`/api/import/wardrobe/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || t("Could not save your changes."));
  return value;
}


export function App() {
  useLanguage();
  const [connectReason, setConnectReason] = useState(() => (needsServerUrl() ? "setup" : null));

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
  const lang = useLanguage();
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Home opens first once the closet can make an outfit; until then, Closet.
  const [chosenView, setView] = useState(null);
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState(() => {
    try { return localStorage.getItem("wardrobe-sort") || "category"; } catch { return "category"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [homeLockId, setHomeLockId] = useState(null);
  const [outfitsFilter, setOutfitsFilter] = useState(null);
  const [outfits, setOutfits] = useState(null);
  const [outfitsError, setOutfitsError] = useState("");
  const [openOutfitId, setOpenOutfitId] = useState(null);
  const [returnToOutfitId, setReturnToOutfitId] = useState(null);
  const [planDay, setPlanDay] = useState(null);
  const [group, setGroup] = useState(null);
  const [sorting, setSorting] = useState(false);
  const { plan, save: savePlan, error: planError } = usePlan();
  const setup = useAiSetup();
  const weather = useWeather();
  const [starterOpen, setStarterOpen] = useState(false);
  const reloadRef = useRef(0);

  useEffect(() => {
    try { localStorage.setItem("wardrobe-sort", sort); } catch { /* storage unavailable */ }
  }, [sort]);

  useEffect(() => {
    const timer = setInterval(ensureImageKey, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Counts up when the closet may have changed elsewhere, to load it again.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const again = () => setReload((count) => count + 1);
    window.addEventListener(CLOSET_CHANGED_EVENT, again);
    return () => window.removeEventListener(CLOSET_CHANGED_EVENT, again);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const isReload = reload > 0;
    reloadRef.current = reload;

    ensureImageKey()
      .then(() => {
        if (controller.signal.aborted) return null;
        return apiFetch("/api/import/wardrobe", { cache: "no-store", signal: controller.signal });
      })
      .then((response) => {
        if (!response) return null;
        if (!response.ok) throw new Error(t("Could not load the wardrobe."));
        return response.json();
      })
      .then(async (loadedItems) => {
        if (!loadedItems || controller.signal.aborted) return;
        const legacyEdits = readLegacyEdits();
        const legacyIds = Object.keys(legacyEdits);
        if (!legacyIds.length) {
          setItems(loadedItems);
          return;
        }
        const loadedSet = new Set(loadedItems.map((entry) => entry.id));
        // Clean up any legacy keys for items that no longer exist.
        for (const id of legacyIds) {
          if (!loadedSet.has(id)) removeLegacyEditId(id);
        }
        const migrated = await Promise.all(loadedItems.map(async (item) => {
          const edit = legacyEdits[item.id];
          if (!edit) return item;
          try {
            const saved = await saveItemToServer(item.id, edit);
            removeLegacyEditId(item.id);
            return saved;
          } catch {
            return { ...item, ...edit };
          }
        }));
        if (!controller.signal.aborted) setItems(migrated);
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError?.name === "AbortError") return;
        // A reload that fails keeps what is on screen.
        if (isReload) return;
        if (isNativeApp() && requestError instanceof TypeError) onConnectionFailed();
        else setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [onConnectionFailed, reload]);

  useEffect(() => {
    const controller = new AbortController();
    const isReload = reload > 0;

    ensureImageKey()
      .then(() => {
        if (controller.signal.aborted) return null;
        return apiFetch("/api/import/outfits", { cache: "no-store", signal: controller.signal });
      })
      .then((response) => {
        if (!response) return null;
        if (!response.ok) throw new Error(t("Could not load outfits."));
        return response.json();
      })
      .then((loadedOutfits) => {
        if (loadedOutfits && !controller.signal.aborted) setOutfits(loadedOutfits);
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError?.name === "AbortError") return;
        if (!isReload) setOutfitsError(requestError.message);
        // Home waits for outfits; give it an empty list so it does not wait forever.
        setOutfits((current) => current ?? []);
      });

    return () => controller.abort();
  }, [reload]);

  const mergeItems = useCallback((saved) => {
    const byId = new Map(saved.filter(Boolean).map((item) => [item.id, item]));
    setItems((current) => current.map((item) => byId.get(item.id) || item));
  }, []);

  const onWorn = useCallback(({ outfit, pieces }) => {
    setOutfits((current) => (current || []).map((entry) => (entry.id === outfit.id ? outfit : entry)));
    mergeItems(pieces);
  }, [mergeItems]);

  const wearItem = async (id, undo) => {
    const updated = await wearPiece(id, { day: dayString(), undo });
    mergeItems([updated]);
    return updated;
  };

  // Avoid flashing Closet skeletons before jumping to Home on cold launch (#070).
  const resolvingInitialView = loading && !chosenView;
  const view = chosenView || (!loading && canMakeOutfit(items) ? "home" : "closet");
  const showingHome = !resolvingInitialView && view === "home";
  const showingOutfits = !resolvingInitialView && view === "outfits";
  const showingPlan = !resolvingInitialView && view === "plan";
  const showingCloset = !resolvingInitialView && view === "closet";
  const browsingAll = activeType === "all" && !query && !colorFilter && !group;

  const groupStats = useMemo(() => {
    const list = [];
    const countsByGroup = {};
    for (const entry of GROUPS) {
      let matched = 0;
      for (const item of items) {
        if (entry.test(item)) matched += 1;
      }
      if (matched > 0) {
        list.push(entry);
        countsByGroup[entry.id] = matched;
      }
    }
    return { list, countsByGroup };
  }, [items]);

  const groupsInCloset = groupStats.list;
  const unsorted = useMemo(() => items.filter(needsSorting).length, [items]);

  const sortCloset = async () => {
    if (!(await askAiConsent(setup))) return;
    setSorting(true);
    setError("");
    try {
      mergeItems((await sendJson("/api/import/wardrobe/sort", "POST", {}, t("Could not sort your closet."))).items || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSorting(false);
    }
  };

  const selectedItem = items.find((item) => item.id === selectedId) || null;

  const counts = useMemo(() => {
    const result = { all: items.length };
    for (const item of items) result[item.part] = (result[item.part] || 0) + 1;
    return result;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = normalizeSearchText(query.trim());
    const words = needle ? needle.split(/\s+/).filter(Boolean) : [];
    const filtered = items.filter((item) => {
      if (activeType !== "all" && item.part !== activeType) return false;
      if (colorFilter && !itemFamilies(item).includes(colorFilter)) return false;
      if (group && !GROUP_MAP[group]?.test(item)) return false;
      if (!words.length) return true;
      const typeInfo = TYPE_MAP[item.part];
      const families = itemFamilies(item);
      const haystack = normalizeSearchText([
        item.name,
        item.kind,
        item.kind && t(item.kind),
        item.formality,
        item.formality && t(DRESS_LABELS[item.formality] || item.formality),
        item.pattern,
        item.pattern && t(PATTERN_LABELS[item.pattern] || item.pattern),
        ...(item.seasons || []),
        ...(item.seasons || []).map((season) => t(SEASON_LABELS[season] || season)),
        typeInfo?.label,
        typeInfo?.singular,
        typeInfo?.label && t(typeInfo.label),
        typeInfo?.singular && t(typeInfo.singular),
        ...families,
        ...families.map((family) => t(COLOR_FAMILY_MAP[family]?.label || family)),
        ...(item.tags || []),
      ].filter(Boolean).join(" "));
      return words.every((word) => haystack.includes(word));
    });
    const orderIndex = new Map(items.map((item, idx) => [item.id, idx]));
    return [...filtered].sort((a, b) => {
      if (sort === "recent") {
        const byDate = (b.addedAt || "").localeCompare(a.addedAt || "");
        return byDate || (orderIndex.get(b.id) ?? 0) - (orderIndex.get(a.id) ?? 0);
      }
      if (sort === "name") return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      if (sort === "color") return colorSortKey(a) - colorSortKey(b);
      const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
      return typeDifference || a.id.localeCompare(b.id);
    });
  }, [activeType, colorFilter, group, items, query, sort, lang]);

  const familiesInCloset = useMemo(() => {
    const present = new Set(items.flatMap(itemFamilies));
    return COLOR_FAMILIES.filter((family) => present.has(family.id));
  }, [items]);

  // Clear a color or smart group filter that no longer matches anything (#110).
  useEffect(() => {
    if (colorFilter && !familiesInCloset.some((family) => family.id === colorFilter)) setColorFilter(null);
  }, [colorFilter, familiesInCloset]);

  useEffect(() => {
    if (group && !groupsInCloset.some((entry) => entry.id === group)) setGroup(null);
  }, [group, groupsInCloset]);

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
      pattern: updatedItem.pattern ?? null,
      seasons: Array.isArray(updatedItem.seasons) && updatedItem.seasons.length ? updatedItem.seasons : null,
    });
    setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  };

  const deleteItem = async (id) => {
    const response = await apiFetch(`/api/import/wardrobe/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(t("Could not delete the item."));
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    setReturnToOutfitId(null);
    // The server drops the piece from outfits (and outfits left too small),
    // so load outfits and the plan again.
    setReload((count) => count + 1);
  };

  const addImportedItem = useCallback((newItem) => {
    if (!newItem) return;
    setItems((current) => (current.some((item) => item.id === newItem.id) ? current : [...current, newItem]));
  }, []);


  const affectedOutfits = useMemo(() => {
    if (!selectedItem || !outfits) return 0;
    return outfits.filter((outfit) => (outfit.garmentIds || []).includes(selectedItem.id)).length;
  }, [selectedItem, outfits]);

  const returnOutfitName = useMemo(() => {
    if (!returnToOutfitId || !outfits) return "";
    return outfits.find((outfit) => outfit.id === returnToOutfitId)?.name || "";
  }, [returnToOutfitId, outfits]);

  const openPieceFromOutfit = useCallback((pieceId, outfitId) => {
    setReturnToOutfitId(outfitId || null);
    setSelectedId(pieceId);
  }, []);

  const closeItemViewer = useCallback(() => {
    setSelectedId(null);
    if (returnToOutfitId) {
      setOpenOutfitId(returnToOutfitId);
      setReturnToOutfitId(null);
    }
  }, [returnToOutfitId]);

  const goToPlanDay = useCallback((day) => {
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) setPlanDay(day);
    else setPlanDay(null);
    setView("plan");
    setSelectedId(null);
  }, []);

  const activeTabId = resolvingInitialView ? "home" : view;

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        <header className="topbar">
          <div className="topbar__row">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><CoatHanger size={20} weight="bold" /></span>
              <div className="brand__text">
                <h1>{t("Wardrobe")}</h1>
                {loading
                  ? <span className="piece-count-skeleton" aria-hidden="true" />
                  : <p className="piece-count">{tn(items.length, "{n} piece", "{n} pieces")}</p>}
              </div>
            </div>

            <div className="view-switch" role="tablist" aria-label={t("Choose a view")}>
              {MAIN_TABS.map(({ id, label, Icon }, index) => {
                const selected = !resolvingInitialView && view === id;
                return (
                  <button
                    key={id}
                    id={`tab-${id}`}
                    type="button"
                    role="tab"
                    tabIndex={activeTabId === id ? 0 : -1}
                    aria-selected={selected}
                    aria-controls={`panel-${id}`}
                    className={selected ? "active" : ""}
                    onClick={() => { setView(id); setSelectedId(null); setReturnToOutfitId(null); }}
                    onKeyDown={(event) => handleRovingKeys(event, {
                      index,
                      count: MAIN_TABS.length,
                      rtl: isRtl(),
                      onSelect: (nextIdx) => {
                        setView(MAIN_TABS[nextIdx].id);
                        setSelectedId(null);
                        setReturnToOutfitId(null);
                      },
                    })}
                  >
                    <Icon size={16} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                    <span>{t(label)}</span>
                  </button>
                );
              })}
            </div>

            <button className="icon-button topbar__add" type="button" onClick={() => window.dispatchEvent(new Event(ADD_CLOTHES_EVENT))} aria-label={t("Add clothes from a photo")}>
              <Camera size={20} aria-hidden="true" />
            </button>
            {items.length > 0 && (
              <button className="icon-button" type="button" onClick={() => setInsightsOpen(true)} aria-label={t("Closet insights")}>
                <ChartBar size={20} aria-hidden="true" />
              </button>
            )}
            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label={t("Settings and connection")}>
              <GearSix size={20} aria-hidden="true" />
            </button>
          </div>

          {showingCloset && (
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
                {(familiesInCloset.length > 1 || groupsInCloset.length > 0 || (unsorted > 0 && setup?.ready)) && (
                  <button
                    type="button"
                    className={`icon-button filter-toggle${filtersOpen || colorFilter || group ? " is-on" : ""}`}
                    aria-expanded={filtersOpen}
                    aria-label={t("Filters")}
                    title={t("Filters")}
                    onClick={() => setFiltersOpen((current) => !current)}
                  >
                    <SlidersHorizontal size={18} aria-hidden="true" />
                    {(colorFilter || group) && <span className="filter-toggle__badge">{(colorFilter ? 1 : 0) + (group ? 1 : 0)}</span>}
                  </button>
                )}
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

              {(filtersOpen || colorFilter) && familiesInCloset.length > 1 && (
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
                      <span className="active-filter-dot" style={{ backgroundColor: COLOR_FAMILY_MAP[colorFilter]?.swatch }} aria-hidden="true" />
                      {t(COLOR_FAMILY_MAP[colorFilter]?.label || "")} <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {(filtersOpen || group || (unsorted > 0 && setup?.ready)) && (groupsInCloset.length > 0 || (unsorted > 0 && setup?.ready)) && (
                <div className="group-filter" role="group" aria-label={t("Smart groups")}>
                  {(filtersOpen || group) && groupsInCloset.map((entry) => (
                    <button key={entry.id} type="button" className={group === entry.id ? "active" : ""} aria-pressed={group === entry.id} onClick={() => setGroup((current) => (current === entry.id ? null : entry.id))}>
                      {t(entry.label, null, "group")} <span className="chip-count">{groupStats.countsByGroup[entry.id] || 0}</span>
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

        {error && <p className="status error" role="alert">{error}</p>}

        {resolvingInitialView && !error && (
          <section className="gallery-grid" aria-label={t("Loading…")} aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <span className="gallery-skeleton" key={index} />)}
          </section>
        )}

        {showingHome && (
          <div role="tabpanel" id="panel-home" aria-labelledby="tab-home">
            <HomeView
              items={items}
              outfits={outfits}
              setOutfits={setOutfits}
              plan={plan}
              weather={weather}
              onWorn={onWorn}
              onOpenPiece={(id) => { setReturnToOutfitId(null); setSelectedId(id); }}
              onGoToPlan={goToPlanDay}
              onGoToFavorites={() => { setOutfitsFilter("favorites"); setView("outfits"); }}
              initialLockId={homeLockId}
              onConsumeInitialLock={() => setHomeLockId(null)}
            />
          </div>
        )}

        {showingOutfits && (
          <div role="tabpanel" id="panel-outfits" aria-labelledby="tab-outfits">
            <OutfitGallery
              items={items}
              outfits={outfits}
              setOutfits={setOutfits}
              loadError={outfitsError}
              weather={weather.today}
              onWorn={onWorn}
              openId={openOutfitId}
              setOpenId={setOpenOutfitId}
              onSelectGarment={openPieceFromOutfit}
              initialFilter={outfitsFilter}
              onConsumeFilter={() => setOutfitsFilter(null)}
            />
          </div>
        )}

        {showingPlan && (
          <div role="tabpanel" id="panel-plan" aria-labelledby="tab-plan">
            <PlanView
              items={items}
              outfits={outfits}
              plan={plan}
              savePlan={savePlan}
              forecast={weather.forecast}
              planError={planError || outfitsError}
              onGoToOutfits={() => setView("outfits")}
              onWorn={onWorn}
              initialDay={planDay}
              onInitialDayHandled={() => setPlanDay(null)}
            />
          </div>
        )}

        {showingCloset && (
          <div role="tabpanel" id="panel-closet" aria-labelledby="tab-closet">
            {!loading && !error && browsingAll && !!items.length && (
              <div className="closet-highlights">
                <ForgottenRow items={items} onOpen={(id) => { setReturnToOutfitId(null); setSelectedId(id); }} />
              </div>
            )}

            {!error && loading && (
              <section className="gallery-grid" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => <span className="gallery-skeleton" key={index} />)}
              </section>
            )}

            {!error && !loading && !items.length && (
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true"><CoatHanger size={34} weight="light" /></span>
                <h2>{t("Your closet is empty")}</h2>
                <p>{t("Add a photo of one piece or a whole outfit. Each piece is cut out and added here.")}</p>
                <div className="empty-state__actions">
                  <button className="primary-button" type="button" onClick={() => window.dispatchEvent(new Event(ADD_CLOTHES_EVENT))}>
                    <Camera size={16} aria-hidden="true" /> {t("Add clothes from a photo")}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setStarterOpen(true)}>
                    <TShirt size={16} aria-hidden="true" /> {t("Add basics without a photo")}
                  </button>
                </div>
              </div>
            )}

            {!!items.length && !visibleItems.length && (
              <div className="empty-state compact">
                <h2>
                  {query || colorFilter || group
                    ? t("No matches")
                    : t("No {type} yet", { type: activeType === "all" ? t("pieces") : t(TYPE_MAP[activeType]?.label || "All").toLowerCase() })}
                </h2>
                <p>
                  {query || colorFilter || group
                    ? t("Nothing in {where} matches these filters.", { where: activeType === "all" ? t("your closet") : t(TYPE_MAP[activeType]?.label || "All").toLowerCase() })
                    : t("Add a photo and it will show up here.")}
                </p>
                <div className="empty-state__actions">
                  {!query && !colorFilter && !group && activeType !== "all" ? (
                    <>
                      <button className="primary-button" type="button" onClick={() => window.dispatchEvent(new Event(ADD_CLOTHES_EVENT))}>
                        <Camera size={15} aria-hidden="true" /> {t("Add clothes")}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => chooseType("all")}>
                        {t("Show all")}
                      </button>
                    </>
                  ) : (
                    <button className="secondary-button" type="button" onClick={() => { setQuery(""); setColorFilter(null); setGroup(null); chooseType("all"); }}>
                      {t("Clear filters")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {!!visibleItems.length && (
              <section className="gallery-grid" aria-label={t(TYPE_MAP[activeType]?.label || "All")}>
                {visibleItems.map((item, index) => (
                  <GalleryItem
                    key={item.id}
                    item={item}
                    index={index}
                    selected={selectedId === item.id}
                    onOpen={(id) => { setReturnToOutfitId(null); setSelectedId(id); }}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </main>

      {selectedItem && (
        <ItemViewer
          item={selectedItem}
          items={items}
          affectedOutfits={affectedOutfits}
          returnOutfitName={returnOutfitName}
          onOpen={(id) => setSelectedId(id)}
          onClose={closeItemViewer}
          onSave={saveItem}
          onDelete={deleteItem}
          onWear={wearItem}
          onPicture={(saved) => setItems((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)))}
          onStyleWith={canMakeOutfit(items) ? (id) => { setReturnToOutfitId(null); setSelectedId(null); setHomeLockId(id); setView("home"); } : null}
        />
      )}
      {insightsOpen && <Suspense fallback={null}><InsightsSheet items={items} outfits={outfits} onOpenPiece={(id) => { setReturnToOutfitId(null); setSelectedId(id); }} onClose={() => setInsightsOpen(false)} /></Suspense>}
      {settingsOpen && <Suspense fallback={null}><SettingsSheet onClose={() => setSettingsOpen(false)} pieces={items.length} weather={weather} /></Suspense>}
      <WardrobeImportFlow onGarmentApproved={addImportedItem} onStarter={() => setStarterOpen(true)} away={view !== "closet"} />
      {starterOpen && <Suspense fallback={null}><StarterPicker onClose={() => setStarterOpen(false)} onAdded={addImportedItem} /></Suspense>}
      <AiConsentPrompt />
    </div>
  );
}
