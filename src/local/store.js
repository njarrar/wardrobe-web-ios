// Where a closet lives when there is no server: files in the app's iCloud
// folder on iPhone and iPad (or on the device when iCloud is off), and a
// browser database elsewhere. Every store has the same small interface.

export function toBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
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
  const store = {
    kind,
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

// A browser: an IndexedDB copy, loaded into memory at start so picture
// links can be made right away.
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
  const values = await run("files", "readonly", (files) => files.getAll());
  keys.forEach((key, index) => memory.files.set(key, values[index]));
  const secrets = new Map();
  const secretKeys = await run("secrets", "readonly", (store) => store.getAllKeys());
  const secretValues = await run("secrets", "readonly", (store) => store.getAll());
  secretKeys.forEach((key, index) => secrets.set(key, secretValues[index]));

  const store = {
    ...memory,
    async writeBytes(path, bytes) { await memory.writeBytes(path, bytes); await run("files", "readwrite", (files) => files.put(bytes, path)); },
    async remove(path) {
      const gone = [...memory.files.keys()].filter((key) => key === path || key.startsWith(`${path}/`));
      await memory.remove(path);
      await run("files", "readwrite", (files) => { gone.forEach((key) => files.delete(key)); return null; });
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
  const plugin = capacitor?.registerPlugin?.("CloudStore");
  if (!plugin) throw new Error("iCloud needs the iPhone or iPad app.");
  const info = await plugin.info();
  const store = {
    kind: info.icloud ? "icloud" : "device",
    root: info.root,
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
