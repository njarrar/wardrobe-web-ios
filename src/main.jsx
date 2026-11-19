// Capacitor core first: it adds registerPlugin and the plugin bridge that
// the iCloud store, Clean cut and native HTTP need on iPhone.
import "@capacitor/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { isNativeApp, loadSavedToken } from "./api.js";
import "./styles.css";
import "./glass.css";
import "./extras.css";
import { applyLanguage } from "./i18n.js";
import { applyTheme } from "./accent.js";
import { announceChange, closetMode, localApi, setClosetMode, startLocalMode } from "./local/mode.js";
import { t } from "./i18n.js";
import packageInfo from "../package.json";

applyLanguage();
applyTheme();

// In the phone app the screen must not zoom: a zoomed web view cuts the
// top and sides off and stays that way. Browsers keep their zoom.
if (isNativeApp()) {
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
}

function render() {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Coming back to the app: the closet may have changed on another device.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") announceChange(300); });

// A picture that is still in iCloud fails to load at first. Ask iCloud for
// it and try again, a few times.
document.addEventListener("error", (event) => {
  const image = event.target;
  const store = localApi()?.store;
  if (!(image instanceof HTMLImageElement) || !store?.fetchFile) return;
  const tries = Number(image.dataset.cloudTries || 0);
  if (tries >= 3) return;
  image.dataset.cloudTries = String(tries + 1);
  const link = image.currentSrc || image.src;
  store.fetchFile(link).then((ready) => {
    if (ready && image.isConnected) image.src = `${link.split("#")[0]}#${tries + 1}`;
  }).catch(() => {});
}, true);

// On a new device iCloud needs a moment to list the closet. Say so.
if (closetMode() === "local") {
  const wait = document.createElement("p");
  wait.className = "cloud-wait";
  wait.textContent = t("Checking iCloud…");
  document.getElementById("root").append(wait);
}

// An iCloud closet opens its files first; if that fails, the app falls back
// to the connect screen and says why.
loadSavedToken()
  .then(() => startLocalMode({ version: packageInfo.version }))
  .catch((error) => { window.__wardrobeLocalError = error.message; setClosetMode("server"); })
  .finally(render);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
