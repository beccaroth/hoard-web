import { toast } from "sonner";
import { supabase } from "./supabase.js";
import { useHoard } from "../store.js";
import { mergeHoards, readBlob, itemVersion, itemSignature } from "./merge.js";

let pushTimer = null;
let pollTimer = null;
let applyingRemote = false; // guards against echoing merged writes back up
let currentUserId = null;
let channel = null;
let lastPullAt = 0; // throttles the focus/visibility/online catch-up pulls
let pendingSignIn = null; // in-flight onSignedIn() so the ready gate can await it

// Realtime is the fast path for receiving another device's changes, but it's
// not reliable on its own: mobile browsers suspend the socket when the tab is
// backgrounded and Supabase doesn't replay events missed while it was down. So
// we also pull on focus/visibility, on regaining network, on realtime
// (re)subscribe, and on a slow background poll. Without this a device only
// learns about remote changes when *it* writes — hence "stale on my phone".
const POLL_MS = 20000;
const PULL_THROTTLE_MS = 3000;

// Initial-load gate: the bookmarklet's incoming link must be filed *after* the
// first session pull settles, otherwise the sign-in merge could race the add.
// Callers register via whenSynced(). (Distinct from markSynced(), which drives
// the sync-status UI.)
let ready = false;
const readyWaiters = [];
function flushReady() {
  if (ready) return;
  ready = true;
  while (readyWaiters.length) readyWaiters.shift()();
}
export function whenSynced(cb) {
  if (ready) cb();
  else readyWaiters.push(cb);
}

// ---- store glue ----

function getLocalBlob() {
  const s = useHoard.getState();
  return { items: s.items, tombstones: s.tombstones };
}

// Apply a merged blob to the store without re-triggering an upward push.
function applyLocal(blob) {
  applyingRemote = true;
  useHoard.setState({ items: blob.items, tombstones: blob.tombstones });
  applyingRemote = false;
}

function setSyncState(syncState) {
  useHoard.setState({ syncState });
}

function markSynced() {
  useHoard.setState({ syncState: "synced", lastSyncAt: Date.now() });
}

// Which account does the locally-persisted hoard belong to? We tag it on sign-in
// and keep the tag across sign-out, so signing in as a *different* user on the
// same browser doesn't merge (and then upload) the previous user's private links
// into the new account. "Merge, never replace" is right for the same identity
// reconnecting — this guard scopes it to that identity.
const OWNER_KEY = "hoard.owner";
function getOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}
function setOwner(userId) {
  try { if (userId) localStorage.setItem(OWNER_KEY, userId); } catch { /* ignore */ }
}

// Count what a merge pulled in, for the user-facing toast.
function describeMerge(before, after) {
  const beforeById = new Map(before.items.map((i) => [i.id, i]));
  const afterById = new Map(after.items.map((i) => [i.id, i]));
  let added = 0, changed = 0, removed = 0;
  for (const [id, it] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) added++;
    else if (!sameItem(prev, it)) changed++;
  }
  for (const id of beforeById.keys()) if (!afterById.has(id)) removed++;
  return { added, changed, removed, total: added + changed + removed };
}

// Compare the fields that represent a real user-visible change, ignoring the
// transient `loading` flag — otherwise an item that's mid-enrich locally counts
// as "updated" against the normalized merged copy and we toast spuriously.
function sameItem(a, b) {
  return (
    a.url === b.url &&
    a.title === b.title &&
    a.favicon === b.favicon &&
    a.state === b.state &&
    (a.added ?? 0) === (b.added ?? 0) &&
    (a.updatedAt ?? 0) === (b.updatedAt ?? 0) &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}

function toastMerge(before, after) {
  const { added, changed, removed, total } = describeMerge(before, after);
  if (!total) return;
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (changed) parts.push(`${changed} updated`);
  if (removed) parts.push(`${removed} removed`);
  toast("Synced from another device", { description: parts.join(" · ") });
}

// ---- remote I/O ----

async function readRemote(userId) {
  const { data, error } = await supabase
    .from("hoards")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[sync] pull failed", error.message);
    return { ok: false, blob: { items: [], tombstones: [] } };
  }
  return { ok: true, blob: readBlob(data?.data) };
}

async function writeRemote(userId, blob) {
  const { error } = await supabase.from("hoards").upsert({
    user_id: userId,
    data: { items: blob.items, tombstones: blob.tombstones },
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[sync] push failed", error.message);
    setSyncState("error");
    return false;
  }
  markSynced();
  return true;
}

// Does the remote blob lack anything our merged blob has — a new item, a newer
// version of an item, a same-version item whose contents differ, or a delete it
// hasn't seen? If not, there's nothing to push and we can skip the write
// (important: the poll calls this constantly).
function remoteNeedsWrite(remote, merged) {
  if (
    merged.items.length !== remote.items.length ||
    merged.tombstones.length !== remote.tombstones.length
  ) return true;
  const rItems = new Map(remote.items.map((i) => [i.id, i]));
  for (const i of merged.items) {
    const r = rItems.get(i.id);
    if (r === undefined) return true;
    const iv = itemVersion(i);
    const rv = itemVersion(r);
    if (iv > rv) return true;
    // Same version but different content: an edit that didn't bump `updatedAt`
    // would otherwise never leave this device. Version alone is the fast path;
    // this is the correctness backstop, and `beats` keeps it from ping-ponging.
    if (iv === rv && itemSignature(i) !== itemSignature(r)) return true;
  }
  const rTomb = new Map(remote.tombstones.map((t) => [t.id, t.deletedAt]));
  for (const t of merged.tombstones) {
    const rd = rTomb.get(t.id);
    if (rd === undefined || t.deletedAt > rd) return true;
  }
  return false;
}

// The one convergence primitive: pull remote, fold local in, apply anything new
// locally, and push back only when remote is actually missing something. Used
// by the debounced push, the poll, and every focus/online/reconnect catch-up.
//   - quiet:        don't flip the status dot to "Syncing…" (for background pulls)
//   - toastOnChange: surface "Synced from another device" when remote had news
async function reconcile(userId, { quiet = false, toastOnChange = false } = {}) {
  if (!userId || applyingRemote) return;
  lastPullAt = Date.now();
  if (!quiet) setSyncState("syncing");
  const { ok, blob: remote } = await readRemote(userId);
  if (!ok) { setSyncState("error"); return; }
  // Snapshot local *after* the round-trip: a quick-add or edit made while we
  // were waiting on the network is in the store now and must survive the merge.
  const local = getLocalBlob();
  const merged = mergeHoards(local, remote);
  if (merged.changed) {
    applyLocal(merged); // remote had items/deletes we lacked
    if (toastOnChange) toastMerge(local, merged);
  }
  if (remoteNeedsWrite(remote, merged)) await writeRemote(userId, merged);
  else markSynced();
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => reconcile(currentUserId), 800);
}

// Background catch-up. Throttled and (by default) visibility-aware so focus +
// visibilitychange firing together don't double-pull, and so we don't poll a
// hidden tab. `ignoreHidden` lets the network/reconnect triggers fire anyway.
function maybePull({ ignoreHidden = false } = {}) {
  if (!currentUserId || applyingRemote) return;
  if (!ignoreHidden && document.visibilityState !== "visible") return;
  if (Date.now() - lastPullAt < PULL_THROTTLE_MS) return;
  reconcile(currentUserId, { quiet: true, toastOnChange: true });
}

// ---- realtime ----

function onRealtime(payload) {
  // "The row changed" is not the same as "here is the row". DELETE events carry
  // no `new`, and Realtime replaces a record that exceeds its size limit with
  // just the primary key plus an error — and the blob grows into that limit as
  // the hoard does. Reading either as an empty hoard makes remoteNeedsWrite true
  // and pushes our blob over whatever is actually there, wiping the very write
  // we were being told about. Go re-read the row instead.
  if (!payload.new?.data) { maybePull({ ignoreHidden: true }); return; }
  const remote = readBlob(payload.new.data);
  const local = getLocalBlob();
  const merged = mergeHoards(local, remote);
  if (merged.changed) {
    applyLocal(merged);
    markSynced();
    toastMerge(local, merged);
  }
  // The event reflects whoever wrote last; if that write didn't include our
  // local changes (concurrent offline edits on both devices), push them up.
  // Our own echo makes remoteNeedsWrite false, so this can't loop.
  if (remoteNeedsWrite(remote, merged)) writeRemote(currentUserId, merged);
}

function setupChannel(userId) {
  channel = supabase
    .channel("hoard:" + userId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "hoards", filter: `user_id=eq.${userId}` },
      onRealtime
    )
    .subscribe((status) => {
      // On (re)subscribe — including after the socket dropped and reconnected —
      // pull once to backfill anything realtime didn't replay.
      if (status === "SUBSCRIBED") maybePull({ ignoreHidden: true });
    });
}

function teardownChannel() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
}

// ---- sign-in: merge, never replace ----

async function onSignedIn(userId) {
  // A different account on this device? Abandon the previous user's local hoard
  // instead of merging it up — it's already on their remote, and merging would
  // leak it into this account. (No owner tag = anonymous local data, which we
  // still adopt on first sign-in, preserving the non-destructive sign-in.)
  const prevOwner = getOwner();
  const switched = prevOwner != null && prevOwner !== userId;
  if (switched) applyLocal({ items: [], tombstones: [] });
  setOwner(userId);

  lastPullAt = Date.now();
  setSyncState("syncing");
  const { ok, blob: remote } = await readRemote(userId);
  if (!ok) { setSyncState("error"); setupChannel(userId); return; }

  // Snapshot local *after* the round-trip so a quick-add filed during the pull
  // (the ?add= deep link) is captured here instead of being clobbered by the
  // merge — empty if we just abandoned another account's data above.
  const local = getLocalBlob();
  const merged = mergeHoards(local, remote);
  applyLocal(merged);
  await writeRemote(userId, merged); // converge remote + seed first-time accounts
  if (!switched) toastMerge(local, merged); // on a switch it's a fresh load, not a cross-device sync
  setupChannel(userId);
}

async function handleSession(session, onAuthChange) {
  onAuthChange?.(session);
  const userId = session?.user?.id ?? null;
  if (userId === currentUserId) {
    // Same user already being handled by another auth event (getSession and
    // onAuthStateChange both fire on load). Await the in-flight sign-in so a
    // caller chaining flushReady doesn't release the gated quick-add before the
    // initial merge has settled — otherwise the add races and can be clobbered.
    if (pendingSignIn) await pendingSignIn;
    return;
  }
  currentUserId = userId;
  teardownChannel();
  if (userId) {
    pendingSignIn = onSignedIn(userId);
    try { await pendingSignIn; } finally { pendingSignIn = null; }
  } else {
    setSyncState("idle");
  }
}

// Bumped by each initSync so a torn-down init can tell that it's been replaced.
let initGeneration = 0;

// Wires auth + realtime + debounced push + catch-up pulls. Returns a cleanup function.
export function initSync(onAuthChange) {
  if (!supabase) { onAuthChange?.(null); flushReady(); return () => {}; }

  // The sync state above is module-level and outlives any one mount, so tearing
  // down has to actually reset it and in-flight work from a dead init has to
  // stay out of the way. Otherwise a remount — StrictMode's double-mount, an HMR
  // reload, App remounting — finds `currentUserId` still set, short-circuits in
  // handleSession, never reaches setupChannel, and quietly runs on the poll
  // alone for the rest of the session.
  const gen = ++initGeneration;
  const alive = () => gen === initGeneration;

  supabase.auth
    .getSession()
    .then(({ data }) => (alive() ? handleSession(data.session, onAuthChange) : null))
    .finally(() => { if (alive()) flushReady(); });
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
    if (alive()) handleSession(session, onAuthChange);
  });

  // push local changes upward (debounced) while signed in — both item edits and deletes
  const onLocalChange = () => {
    if (!currentUserId || applyingRemote) return;
    schedulePush();
  };
  const unsubItems = useHoard.subscribe((s) => s.items, onLocalChange);
  const unsubTombs = useHoard.subscribe((s) => s.tombstones, onLocalChange);

  // Catch up on remote changes realtime may have missed (mobile tab resume,
  // dropped connection, etc): pull on focus/visibility, on regaining network,
  // and on a slow background poll.
  const onVisible = () => maybePull();
  const onOnline = () => maybePull({ ignoreHidden: true });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onOnline);
  pollTimer = setInterval(() => maybePull(), POLL_MS);

  return () => {
    sub.subscription.unsubscribe();
    unsubItems();
    unsubTombs();
    teardownChannel();
    clearTimeout(pushTimer);
    clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onOnline);
    // Hand the next initSync a clean slate — see the `alive` note above.
    currentUserId = null;
    pendingSignIn = null;
    lastPullAt = 0;
  };
}
