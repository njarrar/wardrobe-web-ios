// Photos picked for import wait here until the AI has read them. The
// queue is saved on the device, so closing the app loses nothing: the
// rest is read when the app is opened again.
const NAME = "wardrobe-import-queue";
const STORE = "photos";
const memory = new Map();
let opening = null;

function open() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!opening) {
    opening = new Promise((resolve) => {
      try {
        const request = indexedDB.open(NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onclose = () => { opening = null; };
          db.onerror = () => { opening = null; };
          db.onversionchange = () => { opening = null; db.close(); };
          resolve(db);
        };
        request.onerror = () => { opening = null; resolve(null); };
        request.onblocked = () => { opening = null; resolve(null); };
      } catch {
        opening = null;
        resolve(null);
      }
    });
  }
  return opening;
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22;
}

async function run(mode, work, retried = false) {
  const db = await open();
  if (!db) return work(null);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    if (!retried && error?.name === "InvalidStateError") {
      opening = null;
      return run(mode, work, true);
    }
    if (isQuotaError(error)) {
      throw new Error("Storage is full on this device. Free up space or finish existing imports first.");
    }
    throw error;
  }
}

function dataUrlToBlob(dataUrl) {
  if (typeof Blob === "undefined" || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  try {
    const raw = atob(match[2]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob) {
  if (!blob) return "";
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error || new Error("Could not read queued image"));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function serializePhoto(photo, forIdb) {
  if (!forIdb || !photo?.imageDataUrl) return photo;
  const imageBlob = dataUrlToBlob(photo.imageDataUrl);
  if (!imageBlob) return photo;
  const { imageDataUrl, ...rest } = photo;
  return { ...rest, imageBlob };
}

async function hydratePhoto(entry) {
  if (!entry || entry.imageDataUrl || !entry.imageBlob) return entry;
  const { imageBlob, ...rest } = entry;
  return { ...rest, imageDataUrl: await blobToDataUrl(imageBlob) };
}

// Oldest first.
export async function queuedPhotos() {
  const all = await run("readonly", (store) => (store ? store.getAll() : { result: [...memory.values()] }));
  const list = (all?.result ?? all ?? []).sort((a, b) => a.added - b.added || a.id.localeCompare(b.id));
  return Promise.all(list.map(hydratePhoto));
}

export function savePhoto(photo) {
  return run("readwrite", (store) => (store ? store.put(serializePhoto(photo, true)) : void memory.set(photo.id, photo)));
}

export function dropPhoto(id) {
  return run("readwrite", (store) => (store ? store.delete(id) : void memory.delete(id)));
}

let counter = 0;
export function newPhoto(name, imageDataUrl) {
  counter += 1;
  return { id: `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, added: Date.now(), name, imageDataUrl, status: "waiting", error: "" };
}
