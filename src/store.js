import { create } from "zustand";
import { persist, createJSONStorage, subscribeWithSelector } from "zustand/middleware";
import { toast } from "sonner";
import { extractUrls, normalizeUrl, domain, googleFav, uid } from "./lib/urls.js";
import { fetchMeta } from "./lib/meta.js";

export const SECTIONS = [
  { key: "inbox", label: "Inbox" },
  { key: "later", label: "Saved for Later" },
  { key: "archived", label: "Archived" },
];
const VALID_STATES = new Set(["inbox", "later", "archived"]);

// Parse a search query into `#tag` constraints + free text. Tags can contain
// spaces (e.g. "3d printing"), so each `#…` segment is matched greedily against
// the known tag names (longest first) rather than split on whitespace.
export function parseQuery(query, allTags) {
  const tagWants = [];
  const textParts = [];
  if (!query) return { tagWants, text: "" };
  const lowerTags = [...new Set((allTags || []).map((t) => t.toLowerCase()))]
    .sort((a, b) => b.length - a.length);

  const segs = query.split("#");
  if (segs[0].trim()) textParts.push(segs[0].trim().toLowerCase());
  for (const seg of segs.slice(1)) {
    const lower = seg.toLowerCase();
    const match = lowerTags.find((t) => t && lower.startsWith(t));
    if (match) {
      tagWants.push(match);
      const rest = seg.slice(match.length).trim();
      if (rest) textParts.push(rest.toLowerCase());
    } else {
      // unknown / mid-typing tag: treat the first word as the wanted tag
      const m = seg.match(/^(\S+)(.*)$/);
      if (m) {
        tagWants.push(m[1].toLowerCase());
        if (m[2].trim()) textParts.push(m[2].trim().toLowerCase());
      }
    }
  }
  return { tagWants, text: textParts.join(" ") };
}

// Does an item pass the tag filter + a pre-parsed query?
export function matchesItem(i, { tagFilter, tagWants, text }) {
  if (tagFilter && !(i.tags || []).includes(tagFilter)) return false;
  const tags = (i.tags || []).map((t) => t.toLowerCase());
  for (const want of (tagWants || [])) if (!tags.includes(want)) return false;
  if (text) {
    const hay = (i.title + " " + i.url + " " + tags.join(" ")).toLowerCase();
    if (!hay.includes(text)) return false;
  }
  return true;
}

// Sort a list of items by `added` timestamp. `dir` is "newest" (desc) or "oldest" (asc).
export function sortByAdded(list, dir) {
  const sign = dir === "oldest" ? 1 : -1;
  return list.slice().sort((a, b) => sign * ((a.added || 0) - (b.added || 0)));
}

// Pure selector — used both by the store's actions (via get()) and by the UI.
export function selectVisible({ items, view, tagFilter, query, sort }) {
  const allTags = [...new Set(items.flatMap((i) => i.tags || []))];
  const parsed = parseQuery(query || "", allTags);
  const secs = view === "all" ? SECTIONS : SECTIONS.filter((s) => s.key === view);
  const out = [];
  secs.forEach((s) => {
    const inSec = items.filter((i) => i.state === s.key && matchesItem(i, { tagFilter, ...parsed }));
    sortByAdded(inSec, sort).forEach((i) => out.push(i));
  });
  return out;
}

// Undo history is ephemeral and non-reactive, so it lives outside the store.
const undoStack = [];

export const useHoard = create(
  subscribeWithSelector(
  persist(
    (set, get) => ({
      items: [],
      selId: null,
      view: "all",
      tagFilter: null,
      query: "",
      sort: "newest",
      folded: false,
      editingId: null,
      exportOpen: false,
      status: "",

      // ---- simple setters ----
      setSelId: (selId) => set({ selId }),
      setView: (view) => set({ view, selId: null }),
      setQuery: (query) => set({ query, selId: null }),
      setSort: (sort) => set({ sort, selId: null }),
      toggleSort: () => set((s) => ({ sort: s.sort === "oldest" ? "newest" : "oldest", selId: null })),
      toggleTagFilter: (tag) => set((s) => ({ tagFilter: s.tagFilter === tag ? null : tag, selId: null })),
      clearTagFilter: () => set({ tagFilter: null, selId: null }),
      toggleFolded: () => set((s) => ({ folded: !s.folded })),
      setEditingId: (editingId) => set({ editingId }),
      setExportOpen: (exportOpen) => set({ exportOpen }),
      setStatus: (status) => set({ status }),

      // ---- metadata enrichment ----
      // `keepTitle` preserves a caller-supplied title (e.g. the real page title
      // sent by the bookmarklet) while still upgrading the favicon.
      enrich: async (id, url, { keepTitle = false } = {}) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, loading: true } : i)) }));
        try {
          const data = await fetchMeta(url);
          set((s) => ({
            items: s.items.map((i) =>
              i.id === id
                ? { ...i, title: keepTitle ? i.title : (data.title || i.title), favicon: data.favicon || i.favicon, loading: false }
                : i
            ),
          }));
        } catch {
          set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, loading: false } : i)) }));
        }
      },

      addUrls: (text) => {
        const urls = extractUrls(text);
        if (!urls.length) { set({ status: "No URLs found in that text." }); return; }
        const { items, enrich } = get();
        const seen = new Set(items.map((i) => normalizeUrl(i.url)));
        const fresh = [];
        let dupes = 0;
        urls.forEach((url) => {
          const key = normalizeUrl(url);
          if (seen.has(key)) { dupes++; return; }
          seen.add(key);
          fresh.push({
            id: uid(), url, title: domain(url), favicon: googleFav(url),
            state: "inbox", added: Date.now(), loading: false, tags: [],
          });
        });
        if (fresh.length) set({ items: [...fresh.slice().reverse(), ...items] });
        let msg = fresh.length ? `Filed ${fresh.length} link${fresh.length > 1 ? "s" : ""}.` : "";
        if (dupes) msg += `${msg ? " " : ""}${dupes} duplicate${dupes > 1 ? "s" : ""} skipped.`;
        set({ status: msg || "Already in the hoard." });
        fresh.forEach((it) => enrich(it.id, it.url));
      },

      // Single-link add from the bookmarklet / iOS shortcut (?add=…&title=…).
      // Dedupes like addUrls but keeps the page title the caller hands us.
      quickAdd: ({ url, title }) => {
        if (!url || !/^https?:\/\//i.test(url)) { toast("That doesn't look like a link"); return false; }
        const { items, enrich } = get();
        const key = normalizeUrl(url);
        const existing = items.find((i) => normalizeUrl(i.url) === key);
        if (existing) {
          set({ selId: existing.id, view: "all", status: "Already in your hoard." });
          toast("Already in your hoard", { description: existing.title });
          return false;
        }
        const hasTitle = Boolean(title && title.trim());
        const item = {
          id: uid(), url, title: hasTitle ? title.trim() : domain(url),
          favicon: googleFav(url), state: "inbox", added: Date.now(), loading: false, tags: [],
        };
        set({ items: [item, ...items], selId: item.id, view: "all", status: "Filed to Inbox." });
        toast("Filed to Inbox", { description: item.title });
        enrich(item.id, url, { keepTitle: hasTitle });
        return true;
      },

      // ---- triage ----
      act: (action) => {
        const state = get();
        const item = state.items.find((i) => i.id === state.selId);
        if (!item) return;
        const vis = selectVisible(state);
        const idx = vis.findIndex((i) => i.id === state.selId);
        const nextId = (vis[idx + 1] || vis[idx - 1] || {}).id ?? null;

        if (action === "open") { window.open(item.url, "_blank"); return; }

        const undoAction = { label: "Undo", onClick: () => get().undo() };

        if (action === "delete") {
          undoStack.push({ type: "delete", item, index: state.items.indexOf(item) });
          set({ items: state.items.filter((i) => i.id !== item.id), selId: nextId, status: "Tossed. Press u to undo." });
          toast("Tossed", { action: undoAction });
        } else {
          undoStack.push({ type: "state", id: item.id, prevState: item.state });
          set({
            items: state.items.map((i) => (i.id === item.id ? { ...i, state: action } : i)),
            selId: nextId,
            status: `${action === "later" ? "Saved for later" : action === "archived" ? "Archived" : "Moved to inbox"}. Press u to undo.`,
          });
          const label = action === "later" ? "Saved for later" : action === "archived" ? "Archived" : "Moved to inbox";
          toast(label, { action: undoAction });
        }
      },

      undo: () => {
        const last = undoStack.pop();
        if (!last) { set({ status: "Nothing to undo." }); return; }
        const { items } = get();
        if (last.type === "delete") {
          const copy = [...items];
          copy.splice(Math.min(last.index, copy.length), 0, last.item);
          set({ items: copy, selId: last.item.id, status: "Undone." });
        } else {
          set({ items: items.map((i) => (i.id === last.id ? { ...i, state: last.prevState } : i)), selId: last.id, status: "Undone." });
        }
      },

      moveSel: (dir) => {
        const state = get();
        const vis = selectVisible(state);
        if (!vis.length) return;
        let idx = vis.findIndex((i) => i.id === state.selId);
        idx = Math.max(0, Math.min(vis.length - 1, idx + dir));
        set({ selId: vis[idx].id });
      },

      copyUrl: async () => {
        const { items, selId } = get();
        const item = items.find((i) => i.id === selId);
        if (!item) return;
        try {
          await navigator.clipboard.writeText(item.url);
          toast("Copied", { description: item.url });
        } catch {
          toast("Couldn't copy — clipboard blocked");
        }
      },

      refresh: (id) => {
        const item = get().items.find((i) => i.id === id);
        if (!item || item.loading) return;
        set({ selId: id });
        toast("Refreshing", { description: item.url });
        get().enrich(id, item.url);
      },

      // ---- tags ----
      addTag: (id, raw) => {
        const tag = raw.trim().replace(/^#/, "").toLowerCase();
        if (!tag) return;
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id && !(i.tags || []).includes(tag) ? { ...i, tags: [...(i.tags || []), tag] } : i
          ),
        }));
      },
      removeTag: (id, tag) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, tags: (i.tags || []).filter((t) => t !== tag) } : i)) })),

      // ---- bulk ----
      importItems: (parsed) => {
        if (!Array.isArray(parsed)) throw new Error("expected an array");
        const { items } = get();
        const seen = new Set(items.map((i) => normalizeUrl(i.url)));
        const fresh = [];
        let dupes = 0;
        parsed.forEach((raw) => {
          if (!raw || typeof raw.url !== "string") return;
          const key = normalizeUrl(raw.url);
          if (seen.has(key)) { dupes++; return; }
          seen.add(key);
          fresh.push({
            id: uid(),
            url: raw.url,
            title: raw.title ? String(raw.title) : domain(raw.url),
            favicon: googleFav(raw.url),
            state: VALID_STATES.has(raw.state) ? raw.state : "inbox",
            added: typeof raw.added === "number" ? raw.added : Date.now(),
            loading: false,
            tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map((t) => String(t).toLowerCase()))] : [],
          });
        });
        if (fresh.length) set({ items: [...fresh.slice().reverse(), ...items] });
        let msg = fresh.length ? `Imported ${fresh.length} item${fresh.length > 1 ? "s" : ""}.` : "";
        if (dupes) msg += `${msg ? " " : ""}${dupes} duplicate${dupes > 1 ? "s" : ""} skipped.`;
        toast(msg || "Nothing new to import");
      },

      clearAll: () => { undoStack.length = 0; set({ items: [], selId: null }); },
    }),
    {
      name: "hoard",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items, view: s.view, folded: s.folded, sort: s.sort }),
    }
  )
  )
);
