// Pure, dependency-free merge logic for cross-device sync.
//
// The hoard is stored as a single blob per user: { items, tombstones }. Merging
// is item-level and "newest wins": each item carries `updatedAt`, each delete
// leaves a tombstone { id, deletedAt }. This makes every sync path
// non-destructive — local-only changes survive a pull, deletes propagate
// without resurrecting items, and concurrent writers converge.

const DAY = 24 * 60 * 60 * 1000;
export const TOMBSTONE_TTL = 30 * DAY;

// When did this item last change? Falls back to creation time, then 0, so items
// written before `updatedAt` existed still compare sanely.
function itemVersion(i) {
  return i.updatedAt ?? i.added ?? 0;
}

function normalizeItems(arr) {
  return (Array.isArray(arr) ? arr : []).map((i) => ({
    ...i,
    tags: Array.isArray(i.tags) ? i.tags : [],
    loading: false,
  }));
}

function normalizeTombstones(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((t) => t && t.id != null)
    .map((t) => ({ id: t.id, deletedAt: t.deletedAt ?? 0 }));
}

// Accept either the new blob shape { items, tombstones } or a legacy bare array
// (the old remote/local format) and return a normalized blob.
export function readBlob(raw) {
  if (Array.isArray(raw)) return { items: normalizeItems(raw), tombstones: [] };
  if (raw && typeof raw === "object") {
    return { items: normalizeItems(raw.items), tombstones: normalizeTombstones(raw.tombstones) };
  }
  return { items: [], tombstones: [] };
}

// Drop tombstones older than the TTL so the blob doesn't grow without bound.
export function pruneTombstones(tombstones, now = Date.now(), ttl = TOMBSTONE_TTL) {
  return normalizeTombstones(tombstones).filter((t) => now - t.deletedAt < ttl);
}

// Merge two blobs into one. Returns { items, tombstones, changed } where
// `changed` is true when the merged result differs from `localBlob` (i.e. the
// remote side contributed something) — used to decide whether to surface a toast.
export function mergeHoards(localBlob, remoteBlob, now = Date.now()) {
  const local = readBlob(localBlob);
  const remote = readBlob(remoteBlob);

  // Tombstones: union by id, keep the latest deletion.
  const tombById = new Map();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const prev = tombById.get(t.id);
    if (!prev || t.deletedAt > prev.deletedAt) tombById.set(t.id, t);
  }

  // Items: union by id, keep the newest version.
  const itemById = new Map();
  for (const i of [...local.items, ...remote.items]) {
    const prev = itemById.get(i.id);
    if (!prev || itemVersion(i) > itemVersion(prev)) itemById.set(i.id, i);
  }

  // Apply tombstones. A delete wins unless the surviving item is strictly newer
  // (re-created / edited after the delete), in which case the item wins and its
  // tombstone is discarded so it can't keep killing the resurrected item.
  for (const [id, tomb] of tombById) {
    const item = itemById.get(id);
    if (item && itemVersion(item) > tomb.deletedAt) {
      tombById.delete(id);
    } else {
      itemById.delete(id);
    }
  }

  const items = [...itemById.values()];
  const tombstones = pruneTombstones([...tombById.values()], now);

  // Preserve local ordering for items that stayed; append any new-from-remote
  // items at the front (newest activity surfaces first, matching addUrls).
  const localOrder = new Map(local.items.map((i, idx) => [i.id, idx]));
  items.sort((a, b) => {
    const ai = localOrder.has(a.id) ? localOrder.get(a.id) : -1;
    const bi = localOrder.has(b.id) ? localOrder.get(b.id) : -1;
    return ai - bi;
  });

  const merged = { items, tombstones };
  const changed = JSON.stringify({ items, tombstones }) !== JSON.stringify(local);
  return { ...merged, changed };
}
