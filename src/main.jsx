import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { isNativeApp } from "./api.js";
import "./styles.css";
import "./glass.css";
import "./extras.css";
import { applyLanguage } from "./i18n.js";
import { startLocalMode } from "./local/mode.js";
import packageInfo from "../package.json";

applyLanguage();

function render() {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// An iCloud closet opens its files first; if that fails, the app falls back
// to the connect screen and says why.
startLocalMode({ version: packageInfo.version })
  .catch((error) => { window.__wardrobeLocalError = error.message; })
  .finally(render);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
