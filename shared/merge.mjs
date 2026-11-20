// Rules for joining two copies of a closet. iCloud can hand the app two
// versions of one file when two devices save at about the same time. Each
// piece and outfit carries the time it last changed, and removed ones leave
// a small note, so both copies can be joined without losing anything.

const time = (value) => (typeof value === "string" ? value : "");
const MAX_WEAR_DATES = 730;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().filter((key) => value[key] !== undefined);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Marks what a change touched. Returns the list with updatedAt set on new
// and changed records, plus the ids that were removed.
export function stampChanges(before = [], after = [], now = new Date().toISOString()) {
  const old = new Map(before.map((record) => [record.id, canonicalJson(record)]));
  const kept = new Set();
  const list = after.map((record) => {
    kept.add(record.id);
    return old.get(record.id) === canonicalJson(record) ? record : { ...record, updatedAt: now };
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

// Joins lists of records by id. The copy that changed last wins, concurrent
// wear logs (wornDates) are unioned so neither device loses wear history, and
// a record removed after its last change stays removed.
export function mergeRecords(versions = [], removed = {}) {
  const byId = new Map();
  for (const version of versions) {
    for (const record of Array.isArray(version) ? version : []) {
      if (!record || typeof record.id !== "string") continue;
      const current = byId.get(record.id);
      if (!current) {
        byId.set(record.id, record);
        continue;
      }
      const winner = time(record.updatedAt) > time(current.updatedAt) ? record : current;
      const loser = winner === record ? current : record;
      if (Array.isArray(current.wornDates) || Array.isArray(record.wornDates)) {
        const wornDates = [...new Set([...(loser.wornDates || []), ...(winner.wornDates || [])])]
          .filter((day) => typeof day === "string")
          .sort()
          .slice(-MAX_WEAR_DATES);
        byId.set(record.id, { ...winner, wornDates });
      } else {
        byId.set(record.id, winner);
      }
    }
  }
  return [...byId.values()].filter((record) => !(record.id in removed) || time(record.updatedAt) > time(removed[record.id]));
}

// Joins plans: days, occasions, locked days and trips from every copy, with the newest
// copy's choice winning where two copies planned the same day, while honoring
// removal tombstones (removedDays, removedTrips, removedOccasions).
export function mergePlans(versions = []) {
  const plans = versions.filter((plan) => plan && typeof plan === "object").sort((a, b) => time(a.updatedAt).localeCompare(time(b.updatedAt)));
  if (!plans.length) return {};
  const newest = plans[plans.length - 1];
  const removedDays = trimRemoved(mergeRemoved(plans.map((plan) => plan.removedDays)));
  const removedTrips = trimRemoved(mergeRemoved(plans.map((plan) => plan.removedTrips)));
  const removedOccasions = trimRemoved(mergeRemoved(plans.map((plan) => plan.removedOccasions)));

  const dayEntries = new Map();
  const occasionEntries = new Map();
  const tripEntries = new Map();
  for (const plan of plans) {
    const at = time(plan.updatedAt);
    for (const [day, id] of Object.entries(plan.days && typeof plan.days === "object" ? plan.days : {})) {
      dayEntries.set(day, { id, at });
    }
    for (const [day, id] of Object.entries(plan.occasions && typeof plan.occasions === "object" ? plan.occasions : {})) {
      occasionEntries.set(day, { id, at });
    }
    for (const trip of Array.isArray(plan.trips) ? plan.trips : []) {
      if (trip && typeof trip.id === "string") tripEntries.set(trip.id, { trip, at });
    }
  }

  const days = {};
  for (const [day, entry] of dayEntries) {
    if (!(day in removedDays) || entry.at > time(removedDays[day])) days[day] = entry.id;
  }
  const occasions = {};
  for (const [day, entry] of occasionEntries) {
    if (!(day in removedOccasions) || entry.at > time(removedOccasions[day])) occasions[day] = entry.id;
  }
  const trips = [];
  for (const [id, entry] of tripEntries) {
    if (!(id in removedTrips) || entry.at > time(removedTrips[id])) trips.push(entry.trip);
  }

  const locked = [...new Set(plans.flatMap((plan) => (Array.isArray(plan.lockedDays) ? plan.lockedDays : [])))].filter((day) => day in days).sort();
  const merged = { ...newest, days, occasions, trips };
  if (locked.length) merged.lockedDays = locked;
  else delete merged.lockedDays;
  if (Object.keys(removedDays).length) merged.removedDays = removedDays;
  else delete merged.removedDays;
  if (Object.keys(removedTrips).length) merged.removedTrips = removedTrips;
  else delete merged.removedTrips;
  if (Object.keys(removedOccasions).length) merged.removedOccasions = removedOccasions;
  else delete merged.removedOccasions;
  return merged;
}

// Drops notes about removed records after 90 days, so the file stays small.
export function trimRemoved(removed = {}, now = Date.now()) {
  const cutoff = new Date(now - 90 * 24 * 3600 * 1000).toISOString();
  return Object.fromEntries(Object.entries(removed).filter(([, at]) => time(at) > cutoff));
}
