import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when env isn't configured — the app still works fully offline/local.
export const supabase = url && key ? createClient(url, key) : null;
