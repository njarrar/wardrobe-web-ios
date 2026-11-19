// Photos picked for import wait here until the AI has read them. The
// queue is saved on the device, so closing the app loses nothing: the
// rest is read when the app is opened again.
const NAME = "wardrobe-import-queue";
const STORE = "photos";
const memory = new Map();
let opening;

function open() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  opening ||= new Promise((resolve) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

async function run(mode, work) {
  const db = await open();
  if (!db) return work(null);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// Oldest first.
export async function queuedPhotos() {
  const all = await run("readonly", (store) => store ? store.getAll() : { result: [...memory.values()] });
  return (all?.result ?? all ?? []).sort((a, b) => a.added - b.added || a.id.localeCompare(b.id));
}

export function savePhoto(photo) {
  return run("readwrite", (store) => store ? store.put(photo) : void memory.set(photo.id, photo));
}

export function dropPhoto(id) {
  return run("readwrite", (store) => store ? store.delete(id) : void memory.delete(id));
}

let counter = 0;
export function newPhoto(name, imageDataUrl) {
  counter += 1;
  return { id: `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, added: Date.now(), name, imageDataUrl, status: "waiting", error: "" };
}
