import { supabase } from "./supabase.js";
import { useHoard } from "../store.js";

let pushTimer = null;
let applyingRemote = false; // guards against echoing remote writes back up
let currentUserId = null;
let channel = null;

// Initial-load gate: the bookmarklet's incoming link must be filed *after* the
// first session pull settles, otherwise a "remote wins" sign-in pull (onSignedIn)
// would clobber the just-added item. Callers register via whenSynced().
let synced = false;
const syncedWaiters = [];
function markSynced() {
  if (synced) return;
  synced = true;
  while (syncedWaiters.length) syncedWaiters.shift()();
}
export function whenSynced(cb) {
  if (synced) cb();
  else syncedWaiters.push(cb);
}

function normalize(arr) {
  return (Array.isArray(arr) ? arr : []).map((i) => ({
    ...i,
    tags: Array.isArray(i.tags) ? i.tags : [],
    loading: false,
  }));
}

async function pushNow(items, userId) {
  if (!userId) return;
  const { error } = await supabase
    .from("hoards")
    .upsert({ user_id: userId, data: items, updated_at: new Date().toISOString() });
  if (error) console.error("[sync] push failed", error.message);
}

function schedulePush(items) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(items, currentUserId), 800);
}

function applyRemoteItems(items) {
  const remote = normalize(items);
  const local = useHoard.getState().items;
  if (JSON.stringify(local) === JSON.stringify(remote)) return; // our own echo
  applyingRemote = true;
  useHoard.setState({ items: remote });
  applyingRemote = false;
}

function setupChannel(userId) {
  channel = supabase
    .channel("hoard:" + userId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "hoards", filter: `user_id=eq.${userId}` },
      (payload) => applyRemoteItems(payload.new?.data)
    )
    .subscribe();
}

function teardownChannel() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
}

async function onSignedIn(userId) {
  const { data, error } = await supabase
    .from("hoards")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) { console.error("[sync] pull failed", error.message); return; }

  if (data && Array.isArray(data.data) && data.data.length) {
    // Account already has a hoard — it wins; local is replaced.
    applyRemoteItems(data.data);
  } else {
    // First sign-in for this account — seed it from whatever's local.
    await pushNow(useHoard.getState().items, userId);
  }
  setupChannel(userId);
}

async function handleSession(session, onAuthChange) {
  onAuthChange?.(session);
  const userId = session?.user?.id ?? null;
  if (userId === currentUserId) return;
  currentUserId = userId;
  teardownChannel();
  if (userId) await onSignedIn(userId);
}

// Wires auth + realtime + debounced push. Returns a cleanup function.
export function initSync(onAuthChange) {
  if (!supabase) { onAuthChange?.(null); markSynced(); return () => {}; }

  supabase.auth
    .getSession()
    .then(({ data }) => handleSession(data.session, onAuthChange))
    .finally(markSynced);
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
    handleSession(session, onAuthChange)
  );

  // push local item changes upward (debounced) while signed in
  const unsub = useHoard.subscribe(
    (s) => s.items,
    (items) => {
      if (!currentUserId || applyingRemote) return;
      schedulePush(items);
    }
  );

  return () => {
    sub.subscription.unsubscribe();
    unsub();
    teardownChannel();
    clearTimeout(pushTimer);
  };
}
