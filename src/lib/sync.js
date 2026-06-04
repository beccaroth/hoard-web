import { toast } from "sonner";
import { supabase } from "./supabase.js";
import { useHoard } from "../store.js";
import { mergeHoards, readBlob } from "./merge.js";

let pushTimer = null;
let applyingRemote = false; // guards against echoing merged writes back up
let currentUserId = null;
let channel = null;

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

// Count what a merge pulled in, for the user-facing toast.
function describeMerge(before, after) {
  const beforeById = new Map(before.items.map((i) => [i.id, i]));
  const afterById = new Map(after.items.map((i) => [i.id, i]));
  let added = 0, changed = 0, removed = 0;
  for (const [id, it] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) added++;
    else if (JSON.stringify(prev) !== JSON.stringify(it)) changed++;
  }
  for (const id of beforeById.keys()) if (!afterById.has(id)) removed++;
  return { added, changed, removed, total: added + changed + removed };
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

// Read-merge-write: never overwrite remote blindly. Pull current remote, merge
// our local state into it, write the superset back, and converge local to it.
async function pushNow(userId) {
  if (!userId) return;
  setSyncState("syncing");
  const local = getLocalBlob();
  const { ok, blob: remote } = await readRemote(userId);
  if (!ok) { setSyncState("error"); return; }
  const merged = mergeHoards(local, remote);
  if (merged.changed) applyLocal(merged); // remote had items/deletes we lacked
  await writeRemote(userId, merged);
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(currentUserId), 800);
}

// ---- realtime ----

function onRealtime(payload) {
  const remote = readBlob(payload.new?.data);
  const local = getLocalBlob();
  const merged = mergeHoards(local, remote);
  if (!merged.changed) return; // our own echo, or nothing new
  applyLocal(merged);
  markSynced();
  toastMerge(local, merged);
}

function setupChannel(userId) {
  channel = supabase
    .channel("hoard:" + userId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "hoards", filter: `user_id=eq.${userId}` },
      onRealtime
    )
    .subscribe();
}

function teardownChannel() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
}

// ---- sign-in: merge, never replace ----

async function onSignedIn(userId) {
  setSyncState("syncing");
  const local = getLocalBlob();
  const { ok, blob: remote } = await readRemote(userId);
  if (!ok) { setSyncState("error"); setupChannel(userId); return; }

  const merged = mergeHoards(local, remote);
  applyLocal(merged);
  await writeRemote(userId, merged); // converge remote + seed first-time accounts
  toastMerge(local, merged); // tell the user what the sign-in pulled in
  setupChannel(userId);
}

async function handleSession(session, onAuthChange) {
  onAuthChange?.(session);
  const userId = session?.user?.id ?? null;
  if (userId === currentUserId) return;
  currentUserId = userId;
  teardownChannel();
  if (userId) {
    await onSignedIn(userId);
  } else {
    setSyncState("idle");
  }
}

// Wires auth + realtime + debounced push. Returns a cleanup function.
export function initSync(onAuthChange) {
  if (!supabase) { onAuthChange?.(null); flushReady(); return () => {}; }

  supabase.auth
    .getSession()
    .then(({ data }) => handleSession(data.session, onAuthChange))
    .finally(flushReady);
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
    handleSession(session, onAuthChange)
  );

  // push local changes upward (debounced) while signed in — both item edits and deletes
  const onLocalChange = () => {
    if (!currentUserId || applyingRemote) return;
    schedulePush();
  };
  const unsubItems = useHoard.subscribe((s) => s.items, onLocalChange);
  const unsubTombs = useHoard.subscribe((s) => s.tombstones, onLocalChange);

  return () => {
    sub.subscription.unsubscribe();
    unsubItems();
    unsubTombs();
    teardownChannel();
    clearTimeout(pushTimer);
  };
}
