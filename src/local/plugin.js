// The iPhone app's CloudStore plugin (files in iCloud, secrets in the
// Keychain). One shared handle, because a plugin can be registered once.
let plugin;

export function cloudStore() {
  if (plugin === undefined) plugin = globalThis.Capacitor?.getPlatform?.() === "ios" ? globalThis.Capacitor.registerPlugin?.("CloudStore") || null : null;
  return plugin;
}
