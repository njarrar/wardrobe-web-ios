import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { isNativeApp } from "./api.js";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
