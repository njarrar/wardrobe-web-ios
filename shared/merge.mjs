// Rules for joining two copies of a closet. iCloud can hand the app two
// versions of one file when two devices save at about the same time. Each
// piece and outfit carries the time it last changed, and removed ones leave
// a small note, so both copies can be joined without losing anything.

const time = (value) => (typeof value === "string" ? value : "");

// Marks what a change touched. Returns the list with updatedAt set on new
// and changed records, plus the ids that were removed.
export function stampChanges(before = [], after = [], now = new Date().toISOString()) {
  const old = new Map(before.map((record) => [record.id, JSON.stringify(record)]));
  const kept = new Set();
  const list = after.map((record) => {
    kept.add(record.id);
    return old.get(record.id) === JSON.stringify(record) ? record : { ...record, updatedAt: now };
  });
  return { list, removed: before.filter((record) => !kept.has(record.id)).map((record) => record.id) };
}

// { id: time removed }, keeping the latest time for each id.
export function mergeRemoved(versions = []) {
  const merged = {};
  for (const version of versions) {
    for (const [id, at] of Object.entries(version && typeof version === "object" ? version : {})) {
      if (time(at) > time(merged[id])) merged[id] = at;
    }
  }
  return merged;
}

// Joins lists of records by id. The copy that changed last wins, and a
// record removed after its last change stays removed. Order follows the
// first list, with records only found in later lists added at the end.
export function mergeRecords(versions = [], removed = {}) {
  const byId = new Map();
  for (const version of versions) {
    for (const record of Array.isArray(version) ? version : []) {
      if (!record || typeof record.id !== "string") continue;
      const current = byId.get(record.id);
      if (!current || time(record.updatedAt) > time(current.updatedAt)) byId.set(record.id, record);
    }
  }
  return [...byId.values()].filter((record) => !(record.id in removed) || time(record.updatedAt) > time(removed[record.id]));
}

// Joins plans: days and trips from every copy, with the newest copy's
// choice winning where two copies planned the same day.
export function mergePlans(versions = []) {
  const plans = versions.filter((plan) => plan && typeof plan === "object").sort((a, b) => time(a.updatedAt).localeCompare(time(b.updatedAt)));
  if (!plans.length) return {};
  const newest = plans[plans.length - 1];
  const days = Object.assign({}, ...plans.map((plan) => plan.days || {}));
  const trips = new Map();
  for (const plan of plans) for (const trip of Array.isArray(plan.trips) ? plan.trips : []) trips.set(trip.id, trip);
  return { ...newest, days, trips: [...trips.values()] };
}

// Drops notes about removed records after 90 days, so the file stays small.
export function trimRemoved(removed = {}, now = Date.now()) {
  const cutoff = new Date(now - 90 * 24 * 3600 * 1000).toISOString();
  return Object.fromEntries(Object.entries(removed).filter(([, at]) => time(at) > cutoff));
}
