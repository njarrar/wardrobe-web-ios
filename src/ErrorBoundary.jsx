import React from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { t } from "./i18n.js";

const VIEW_STATE_KEYS = ["wardrobe-sort", "wardrobe-home", "wardrobe-plan-mode"];

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error("Unexpected error") };
  }

  componentDidCatch(error, info) {
    if (typeof console !== "undefined" && console.error) {
      console.error("Wardrobe render error:", error, info?.componentStack);
    }
  }

  resetViewState = () => {
    for (const key of VIEW_STATE_KEYS) {
      try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    }
    this.setState({ error: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-boundary" role="alert">
        <div className="error-boundary__card glass-card">
          <span className="error-boundary__icon" aria-hidden="true">
            <WarningCircle size={32} weight="light" />
          </span>
          <h1>{t("Something went wrong")}</h1>
          <p>{t("The app ran into an unexpected error. Reload to try again, or reset local view settings.")}</p>
          {this.state.error?.message && (
            <p className="error-boundary__detail">{this.state.error.message}</p>
          )}
          <div className="error-boundary__actions">
            <button type="button" className="primary-button" onClick={this.reload}>
              <ArrowClockwise size={15} aria-hidden="true" /> {t("Reload")}
            </button>
            <button type="button" className="secondary-button" onClick={this.resetViewState}>
              {t("Reset view state")}
            </button>
          </div>
        </div>
      </main>
    );
  }
}
