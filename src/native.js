// Things only the phone app can do: taps you can feel, the system photo
// picker and the Home Screen widget. On the web each of these does nothing
// or falls back to the browser's own way.

const plugins = {};
function plugin(name) {
  if (!(name in plugins)) {
    const bridge = globalThis.Capacitor;
    plugins[name] = bridge?.getPlatform?.() === "ios" ? bridge.registerPlugin?.(name) || null : null;
  }
  return plugins[name];
}

// style: "light" (most buttons), "medium", "select" (a small tick) or
// "success" (a job done, such as Wear this).
export function tap(style = "light") {
  const haptics = plugin("Haptics");
  if (haptics) { haptics.tap({ style }).catch(() => {}); return; }
  if (globalThis.Capacitor?.getPlatform?.() === "android") { try { navigator.vibrate?.(style === "success" ? 18 : 8); } catch { /* not allowed */ } }
}

export function hasPhotoPicker() {
  return Boolean(plugin("PhotoPicker"));
}

// Opens the system photo picker and gives back File objects. The phone has
// already made each photo smaller, so they are light to hold.
export async function pickPhotos(limit = 20) {
  const picker = plugin("PhotoPicker");
  if (!picker) return null;
  const { files = [], failed = 0 } = await picker.pick({ limit });
  const picked = [];
  for (const entry of files) {
    try {
      const response = await fetch(globalThis.Capacitor.convertFileSrc(entry.path));
      if (!response.ok) throw new Error("not read");
      picked.push(new File([await response.blob()], entry.name || "photo.jpg", { type: "image/jpeg" }));
    } catch { /* this photo is skipped; the count below tells the caller */ }
  }
  return { files: picked, failed: failed + files.length - picked.length };
}

async function dataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("not read");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let lastWidget = "";
let widgetTimer = null;

// days: [{ day, title, line, pieces: [{ id, url }] }]. Sends the week's
// outfits to the widget, a moment after the last change, and only when
// something is new.
export function updateWidget(days, emptyText) {
  const bridge = plugin("WidgetBridge");
  if (!bridge) return;
  const signature = JSON.stringify([emptyText, days.map((entry) => [entry.day, entry.title, entry.line, entry.pieces.map((piece) => piece.id)])]);
  if (signature === lastWidget) return;
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(async () => {
    try {
      const pictures = {};
      for (const entry of days) {
        for (const piece of entry.pieces) {
          if (piece.id in pictures || !piece.url) continue;
          try { pictures[piece.id] = await dataUrl(piece.url); } catch { /* the widget shows the others */ }
        }
      }
      const result = await bridge.update({ days: days.map((entry) => ({ day: entry.day, title: entry.title, line: entry.line, pieces: entry.pieces.map((piece) => piece.id).filter((id) => id in pictures) })), pictures, emptyText });
      if (result?.saved) lastWidget = signature;
    } catch { /* the widget keeps what it had */ }
  }, 1500);
}
