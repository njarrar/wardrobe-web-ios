import { useMemo, useRef } from "react";
import { ChartBar, CurrencyDollar, Fire, HeartBreak, Sparkle, X } from "@phosphor-icons/react";
import { assetUrl } from "./api.js";
import { closetInsights, formatMoney, idleLabel } from "../shared/style.mjs";
import { humanColorName } from "../shared/pairing.mjs";
import { useSheetDrag } from "./useSheetDrag.js";
import { useDialog } from "./dialog.js";
import { locale, t, tn } from "./i18n.js";

// Closet Insights & Cost-Per-Wear analytics sheet: real numbers computed from
// the user's own pieces, wear dates, prices and color palette.
export function InsightsSheet({ items, outfits = [], onOpenPiece, onClose }) {
  const { handleProps, sheetStyle } = useSheetDrag(onClose);
  const stats = useMemo(() => closetInsights(items), [items]);

  const colorBreakdown = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!item.color) continue;
      const name = humanColorName(item.color);
      const entry = map.get(name) || { name, swatch: item.color, count: 0 };
      entry.count += 1;
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [items]);

  const sheetRef = useRef(null);
  useDialog({ open: true, onClose, containerRef: sheetRef });

  const openPiece = (id) => {
    onClose();
    onOpenPiece?.(id);
  };

  return (
    <div className="viewer-overlay sheet-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} className="settings-sheet insights-sheet" role="dialog" aria-modal="true" aria-labelledby="insights-title" style={sheetStyle}>
        <span className="sheet-grabber" aria-hidden="true" {...handleProps} />
        <header className="settings-sheet__header" {...handleProps}>
          <div>
            <p className="eyebrow">{t("Closet insights")}</p>
            <h2 id="insights-title">{t("Your closet in numbers")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close insights")}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="insights-kpis">
          <article className="insights-kpi">
            <span>{t("Pieces")}</span>
            <strong>{stats.totalPieces}</strong>
            <small>{tn((outfits || []).length, "{n} outfit", "{n} outfits")}</small>
          </article>
          <article className="insights-kpi">
            <span>{t("Worn in 60 days")}</span>
            <strong>{stats.utilizationPct}%</strong>
            <small>{t("{n} worn lately", { n: stats.wornRecentlyCount })}</small>
          </article>
          <article className="insights-kpi">
            <span>{t("Closet value")}</span>
            <strong>{stats.pricedCount ? formatMoney(stats.totalValue) : "-"}</strong>
            <small>{stats.pricedCount ? tn(stats.pricedCount, "{n} priced", "{n} priced") : t("Add prices to track")}</small>
          </article>
          <article className="insights-kpi">
            <span>{t("Avg cost / wear")}</span>
            <strong>{stats.avgCostPerWear !== null ? formatMoney(stats.avgCostPerWear) : "-"}</strong>
            <small>{tn(stats.totalWears, "{n} wear logged", "{n} wears logged")}</small>
          </article>
        </div>

        {colorBreakdown.length > 0 && (
          <section className="insights-section">
            <h3><ChartBar size={16} aria-hidden="true" /> {t("Color palette")}</h3>
            <div className="insights-palette-bar" aria-hidden="true">
              {colorBreakdown.map((entry) => (
                <span
                  key={entry.name}
                  style={{ flex: entry.count, backgroundColor: entry.swatch }}
                  title={`${t(entry.name)}: ${entry.count}`}
                />
              ))}
            </div>
            <ul className="insights-palette-list">
              {colorBreakdown.map((entry) => (
                <li key={entry.name}>
                  <span className="insights-dot" style={{ backgroundColor: entry.swatch }} aria-hidden="true" />
                  <span>{t(entry.name)}</span>
                  <strong>{Math.round((entry.count / Math.max(1, items.length)) * 100)}%</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        {stats.mostWorn.length > 0 && (
          <section className="insights-section">
            <h3><Fire size={16} aria-hidden="true" /> {t("Most worn")}</h3>
            <div className="insights-rows">
              {stats.mostWorn.map(({ item, wears }) => (
                <button type="button" className="insights-row" key={item.id} onClick={() => openPiece(item.id)}>
                  <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
                  <span className="insights-row__body">
                    <strong>{item.name}</strong>
                    <small>{tn(wears, "{n} wear", "{n} wears")}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {stats.bestValue.length > 0 && (
          <section className="insights-section">
            <h3><CurrencyDollar size={16} aria-hidden="true" /> {t("Best cost per wear")}</h3>
            <div className="insights-rows">
              {stats.bestValue.map(({ item, cpw, wears }) => (
                <button type="button" className="insights-row" key={item.id} onClick={() => openPiece(item.id)}>
                  <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
                  <span className="insights-row__body">
                    <strong>{item.name}</strong>
                    <small>{t("{cost} per wear · {n} wears", { cost: formatMoney(cpw), n: wears })}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {stats.needsLove.length > 0 && (
          <section className="insights-section">
            <h3><HeartBreak size={16} aria-hidden="true" /> {t("Not worn lately")}</h3>
            <div className="insights-rows">
              {stats.needsLove.map(({ item }) => (
                <button type="button" className="insights-row" key={item.id} onClick={() => openPiece(item.id)}>
                  <img src={assetUrl(item.thumbnail || item.image)} alt="" loading="lazy" />
                  <span className="insights-row__body">
                    <strong>{item.name}</strong>
                    <small>{idleLabel(item, undefined, t, locale())}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!stats.mostWorn.length && !stats.needsLove.length && (
          <p className="status"><Sparkle size={15} aria-hidden="true" /> {t("Wear a few outfits and add prices to see more here.")}</p>
        )}
      </section>
    </div>
  );
}
