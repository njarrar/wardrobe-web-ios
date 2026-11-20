// Where a closet lives when there is no server: files in the app's iCloud
// folder on iPhone and iPad (or on the device when iCloud is off), and a
// browser database elsewhere. Every store has the same small interface.

import { cloudStore } from "./plugin.js";

export function toBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x2000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x2000));
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const typeOf = (path) => (path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream");

function jsonHelpers(store) {
  return {
    async readJson(name, fallback) {
      const bytes = await store.readBytes(name);
      if (!bytes) return fallback;
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return fallback; }
    },
    // Every copy iCloud holds of a file, the current one first. More than
    // one means two devices saved at about the same time.
    async readVersions(name) {
      const copies = store.readCopies ? await store.readCopies(name) : [await store.readBytes(name)];
      const parsed = [];
      for (const bytes of copies) {
        if (!bytes) continue;
        try { parsed.push(JSON.parse(new TextDecoder().decode(bytes))); } catch { /* skip a broken copy */ }
      }
      parsed.clash = copies.length > 1;
      return parsed;
    },
    async settle(name) { await store.settleCopies?.(name); },
    writeJson(name, value) {
      return store.writeBytes(name, new TextEncoder().encode(JSON.stringify(value)));
    },
  };
}

// In memory: tests, and the base of the browser store.
export function createMemoryStore({ kind = "device" } = {}) {
  const files = new Map();
  const secrets = new Map();
  const urls = new Map();
  // Tests put extra copies here to stand in for an iCloud clash.
  const clashes = new Map();
  const store = {
    kind,
    clashes,
    async readCopies(path) { return [files.get(path) || null, ...(clashes.get(path) || [])]; },
    async settleCopies(path) { clashes.delete(path); },
    async readBytes(path) { return files.get(path) || null; },
    async writeBytes(path, bytes) {
      files.set(path, bytes);
      if (urls.has(path)) { URL.revokeObjectURL?.(urls.get(path)); urls.delete(path); }
    },
    async remove(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          files.delete(key);
          if (urls.has(key)) { URL.revokeObjectURL?.(urls.get(key)); urls.delete(key); }
        }
      }
    },
    fileUrl(path) {
      const bytes = files.get(path);
      if (!bytes) return "";
      if (!urls.has(path)) urls.set(path, URL.createObjectURL(new Blob([bytes], { type: typeOf(path) })));
      return urls.get(path);
    },
    async getSecret(key) { return secrets.get(key) ?? null; },
    async setSecret(key, value) { if (value == null) secrets.delete(key); else secrets.set(key, value); },
    files,
  };
  return Object.assign(store, jsonHelpers(store));
}

// A browser: IndexedDB store that eagerly loads only small JSON metadata on
// boot and lazy-loads binary image blobs on demand with LRU URL eviction.
const MAX_CACHED_BLOBS = 80;

export async function createWebStore() {
  const memory = createMemoryStore({ kind: "device" });
  let db = null;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("wardrobe-closet", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("files"); request.result.createObjectStore("secrets"); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch { return memory; }
  const run = (name, mode, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = action(transaction.objectStore(name));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
  });
  const keys = await run("files", "readonly", (files) => files.getAllKeys());
  const knownKeys = new Set(keys);
  // Load only small JSON files up front; image blobs stay in IndexedDB until needed.
  for (const key of keys) {
    if (typeof key === "string" && key.endsWith(".json")) {
      const bytes = await run("files", "readonly", (files) => files.get(key));
      if (bytes) memory.files.set(key, bytes);
    }
  }
  const secrets = new Map();
  const secretKeys = await run("secrets", "readonly", (store) => store.getAllKeys());
  const secretValues = await run("secrets", "readonly", (store) => store.getAll());
  secretKeys.forEach((key, index) => secrets.set(key, secretValues[index]));

  // LRU cache for image ObjectURLs to cap RAM usage in large closets.
  const blobUrls = new Map();
  const loadingUrls = new Set();
  const changeListeners = new Set();
  let notifyTimer = null;
  const notifyReady = () => {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      for (const listener of changeListeners) listener();
    }, 60);
  };
  const cacheBlobUrl = (path, bytes) => {
    if (blobUrls.has(path)) {
      const existing = blobUrls.get(path);
      blobUrls.delete(path);
      blobUrls.set(path, existing);
      return existing;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: typeOf(path) }));
    blobUrls.set(path, url);
    if (blobUrls.size > MAX_CACHED_BLOBS) {
      const oldest = blobUrls.keys().next().value;
      URL.revokeObjectURL?.(blobUrls.get(oldest));
      blobUrls.delete(oldest);
      if (!oldest.endsWith(".json")) memory.files.delete(oldest);
    }
    return url;
  };
  const dropBlobUrl = (path) => {
    if (blobUrls.has(path)) {
      URL.revokeObjectURL?.(blobUrls.get(path));
      blobUrls.delete(path);
    }
  };

  const store = {
    ...memory,
    onChange(listener) { changeListeners.add(listener); },
    async readCopies(path) { return [await store.readBytes(path)]; },
    async readBytes(path) {
      const cached = memory.files.get(path);
      if (cached) return cached;
      if (!knownKeys.has(path)) return null;
      const bytes = await run("files", "readonly", (files) => files.get(path));
      if (bytes && path.endsWith(".json")) memory.files.set(path, bytes);
      return bytes || null;
    },
    async writeBytes(path, bytes) {
      knownKeys.add(path);
      dropBlobUrl(path);
      if (path.endsWith(".json")) await memory.writeBytes(path, bytes);
      else cacheBlobUrl(path, bytes);
      await run("files", "readwrite", (files) => files.put(bytes, path));
    },
    async remove(path) {
      const gone = [...knownKeys].filter((key) => key === path || key.startsWith(`${path}/`));
      for (const key of gone) {
        knownKeys.delete(key);
        dropBlobUrl(key);
      }
      await memory.remove(path);
      if (gone.length) await run("files", "readwrite", (files) => { gone.forEach((key) => files.delete(key)); return null; });
    },
    fileUrl(path) {
      if (blobUrls.has(path)) {
        const url = blobUrls.get(path);
        blobUrls.delete(path);
        blobUrls.set(path, url);
        return url;
      }
      const cached = memory.files.get(path);
      if (cached) return cacheBlobUrl(path, cached);
      if (knownKeys.has(path) && !loadingUrls.has(path)) {
        loadingUrls.add(path);
        run("files", "readonly", (files) => files.get(path))
          .then((bytes) => {
            if (bytes) {
              cacheBlobUrl(path, bytes);
              notifyReady();
            }
          })
          .catch(() => {})
          .finally(() => { loadingUrls.delete(path); });
      }
      return "";
    },
    async getSecret(key) { return secrets.get(key) ?? null; },
    async setSecret(key, value) {
      if (value == null) secrets.delete(key); else secrets.set(key, value);
      await run("secrets", "readwrite", (store) => (value == null ? store.delete(key) : store.put(value, key)));
    },
  };
  return Object.assign(store, jsonHelpers(store));
}

// iPhone and iPad: the CloudStore plugin in ios/App/App/CloudStorePlugin.swift.
// Files sit in the app's iCloud Drive folder, and AI keys in the Keychain.
export async function createNativeStore() {
  const capacitor = globalThis.Capacitor;
  const plugin = cloudStore();
  if (!plugin) throw new Error("iCloud needs the iPhone or iPad app.");
  // Waits until iCloud has listed the closet's files, so a new device
  // never mistakes "not here yet" for "empty".
  const info = await plugin.info();
  const store = {
    kind: info.icloud ? "icloud" : "device",
    root: info.root,
    async readCopies(path) {
      const result = await plugin.read({ path, conflicts: true });
      if (result.missing) return [null];
      return [fromBase64(result.data), ...(result.conflicts || []).map(fromBase64)];
    },
    async settleCopies(path) { await plugin.settle({ path }); },
    // Asks iCloud to bring a picture down. Takes the link the page used.
    async fetchFile(url) {
      let text;
      try { text = decodeURIComponent(String(url).split(/[?#]/, 1)[0]); } catch { return false; }
      const at = text.indexOf(info.root);
      if (at === -1) return false;
      const path = text.slice(at + info.root.length).replace(/^\/+/, "");
      return Boolean((await plugin.download({ path })).ready);
    },
    // Calls back when iCloud brings changes from another device.
    onChange(listener) { plugin.addListener?.("changed", listener); },
    async readBytes(path) {
      const result = await plugin.read({ path });
      return result.missing ? null : fromBase64(result.data);
    },
    async writeBytes(path, bytes) { await plugin.write({ path, data: toBase64(bytes) }); },
    async remove(path) { await plugin.remove({ path }); },
    fileUrl(path) { return capacitor.convertFileSrc(`${info.root}/${path}`); },
    async getSecret(key) { return (await plugin.getSecret({ key })).value ?? null; },
    async setSecret(key, value) { await plugin.setSecret({ key, value: value ?? null }); },
  };
  return Object.assign(store, jsonHelpers(store));
}
