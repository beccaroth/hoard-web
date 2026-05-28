import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when env isn't configured — the app still works fully offline/local.
// The no-op lock sidesteps a navigator.locks deadlock that hangs auth calls
// (notably signOut) across Vite HMR reloads.
export const supabase = url && key
  ? createClient(url, key, { auth: { lock: async (_n, _t, fn) => fn() } })
  : null;
