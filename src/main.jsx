import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { isNativeApp } from "./api.js";
import "./styles.css";
import "./glass.css";
import "./extras.css";
import { applyLanguage } from "./i18n.js";

applyLanguage();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
