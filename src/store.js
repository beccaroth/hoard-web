import { create } from "zustand";
import { persist, createJSONStorage, subscribeWithSelector } from "zustand/middleware";
import { toast } from "sonner";
import { extractUrls, normalizeUrl, domain, googleFav, urlId } from "./lib/urls.js";
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
      tombstones: [], // { id, deletedAt } — deletes that must propagate across devices
      selId: null,
      view: "all",
      tagFilter: null,
      query: "",
      sort: "newest",
      editingId: null,
      renamingId: null,
      exportOpen: false,
      // The details sidebar is desktop-only, and whether you want it open is a
      // lasting preference rather than a per-visit one — so it persists.
      detailsOpen: true,
      // Triage is a sitting, not a place: it always opens on whatever the inbox
      // holds right now, so reopening the app in it would be a surprise. Lives
      // in the store rather than in App's own state only so the global key
      // handler — bound once, reading getState() — can see it and stand down.
      triageOpen: false,
      // sync status — non-persisted, driven by lib/sync.js
      syncState: "idle", // "idle" | "syncing" | "synced" | "error"
      lastSyncAt: null,

      // ---- simple setters ----
      setSyncState: (syncState) => set({ syncState }),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
      setSelId: (selId) => set({ selId }),
      setView: (view) => set({ view, selId: null }),
      setQuery: (query) => set({ query, selId: null }),
      setSort: (sort) => set({ sort, selId: null }),
      toggleSort: () => set((s) => ({ sort: s.sort === "oldest" ? "newest" : "oldest", selId: null })),
      toggleTagFilter: (tag) => set((s) => ({ tagFilter: s.tagFilter === tag ? null : tag, selId: null })),
      clearTagFilter: () => set({ tagFilter: null, selId: null }),
      setEditingId: (editingId) => set({ editingId }),
      setRenamingId: (renamingId) => set({ renamingId }),
      setExportOpen: (exportOpen) => set({ exportOpen }),
      toggleDetails: () => set((s) => ({ detailsOpen: !s.detailsOpen })),
      setTriageOpen: (triageOpen) => set({ triageOpen }),

      // ---- metadata enrichment ----
      // The fetch is slow enough to land after the user has moved on, so the
      // title is only taken when nobody has a better claim on it. It's held when
      // the caller supplied a real one (`keepTitle` — e.g. the bookmarklet's page
      // title), when the user has typed their own (`titleEdited`), or while the
      // row's rename editor is open, since that editor seeded its draft from the
      // current title and swapping it underneath would land a merged or stale
      // title on commit. The favicon is always upgraded either way.
      enrich: async (id, url, { keepTitle = false } = {}) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, loading: true } : i)) }));
        try {
          const data = await fetchMeta(url);
          set((s) => ({
            items: s.items.map((i) => {
              if (i.id !== id) return i;
              const hold = keepTitle || i.titleEdited || s.renamingId === id;
              return {
                ...i,
                title: hold ? i.title : (data.title || i.title),
                favicon: data.favicon || i.favicon,
                // Written even when empty. An item that has been looked at and
                // has no description holds "", which is what tells the triage
                // card not to go asking again every time it comes round.
                description: typeof data.description === "string" ? data.description : (i.description || ""),
                image: data.image || i.image || null,
                loading: false,
                updatedAt: Date.now(),
              };
            }),
          }));
        } catch {
          set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, loading: false } : i)) }));
        }
      },

      addUrls: (text) => {
        const urls = extractUrls(text);
        if (!urls.length) { toast("No links found in that text"); return; }
        const { items, enrich } = get();
        const seen = new Set(items.map((i) => normalizeUrl(i.url)));
        const fresh = [];
        let dupes = 0;
        urls.forEach((url) => {
          const key = normalizeUrl(url);
          if (seen.has(key)) { dupes++; return; }
          seen.add(key);
          const now = Date.now();
          fresh.push({
            id: urlId(url), url, title: domain(url), favicon: googleFav(url),
            state: "inbox", added: now, updatedAt: now, loading: false, tags: [],
          });
        });
        if (fresh.length) set({ items: [...fresh.slice().reverse(), ...items], view: "all" });
        const skipped = dupes ? `${dupes} already stashed` : undefined;
        if (fresh.length) toast(`Stashed ${fresh.length} link${fresh.length > 1 ? "s" : ""}`, { description: skipped });
        else toast("Already in your hoard", { description: skipped });
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
          set({ selId: existing.id, view: "all" });
          toast("Already in your hoard", { description: existing.title });
          return false;
        }
        const hasTitle = Boolean(title && title.trim());
        const now = Date.now();
        const item = {
          id: urlId(url), url, title: hasTitle ? title.trim() : domain(url),
          favicon: googleFav(url), state: "inbox", added: now, updatedAt: now, loading: false, tags: [],
        };
        set({ items: [item, ...items], selId: item.id, view: "all" });
        toast("Stashed", { description: item.title });
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
          set({
            items: state.items.filter((i) => i.id !== item.id),
            tombstones: [...state.tombstones.filter((t) => t.id !== item.id), { id: item.id, deletedAt: Date.now() }],
            selId: nextId,
          });
          toast("Tossed", { action: undoAction });
        } else {
          undoStack.push({ type: "state", id: item.id, prevState: item.state });
          set({
            items: state.items.map((i) => (i.id === item.id ? { ...i, state: action, updatedAt: Date.now() } : i)),
            selId: nextId,
          });
          const label = action === "later" ? "Saved for later" : action === "archived" ? "Archived" : "Moved to inbox";
          toast(label, { action: undoAction });
        }
      },

      undo: () => {
        const last = undoStack.pop();
        if (!last) { toast("Nothing to undo"); return; }
        const { items, tombstones } = get();
        if (last.type === "delete") {
          // Triage can put a deleted link back on its own, by walking to the
          // card rather than by reaching for the stack. If it already did, the
          // entry is spent — splicing it in again would leave two of the link.
          if (items.some((i) => i.id === last.item.id)) { set({ selId: last.item.id }); return; }
          const copy = [...items];
          // Restore with a fresh updatedAt so the un-delete out-races its own tombstone on merge.
          copy.splice(Math.min(last.index, copy.length), 0, { ...last.item, updatedAt: Date.now() });
          set({
            items: copy,
            tombstones: tombstones.filter((t) => t.id !== last.item.id),
            selId: last.item.id,
          });
        } else if (last.type === "rename") {
          set({
            items: items.map((i) =>
              i.id === last.id ? { ...i, title: last.prevTitle, titleEdited: last.prevEdited, updatedAt: Date.now() } : i
            ),
            selId: last.id,
          });
        } else {
          set({ items: items.map((i) => (i.id === last.id ? { ...i, state: last.prevState, updatedAt: Date.now() } : i)), selId: last.id });
        }
      },

      // Un-delete by name rather than by position on the undo stack. Triage's
      // back button can land on a card that was deleted several decisions ago,
      // where undo would reverse whatever happened since instead. Same repair
      // as undo's delete branch — the item goes back with a fresh `updatedAt`
      // so it out-races its own tombstone on the next merge — but reachable
      // whenever the link is in front of you.
      restoreItem: (item) => {
        if (!item?.id) return;
        const { items, tombstones } = get();
        if (items.some((i) => i.id === item.id)) { set({ selId: item.id }); return; }
        set({
          items: [{ ...item, state: "inbox", updatedAt: Date.now() }, ...items],
          tombstones: tombstones.filter((t) => t.id !== item.id),
          selId: item.id,
        });
        toast("Back in your inbox", { description: item.title });
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

      // Explicit "refresh title & favicon" — also the way back from a manual
      // rename, so it drops `titleEdited` and lets enrich re-apply the page title.
      refresh: (id) => {
        const item = get().items.find((i) => i.id === id);
        if (!item || item.loading) return;
        if (item.titleEdited) undoStack.push({ type: "rename", id, prevTitle: item.title, prevEdited: true });
        // `updatedAt` is what carries a change across devices, so clearing the
        // flag has to bump it even though the title itself hasn't moved yet —
        // and especially if the enrich below fails and never bumps it for us.
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, titleEdited: false, updatedAt: Date.now() } : i)),
          selId: id,
        }));
        toast("Refreshing", { description: item.url });
        get().enrich(id, item.url);
      },

      // ---- rename ----
      renameItem: (id, raw) => {
        const title = (raw || "").trim();
        const item = get().items.find((i) => i.id === id);
        if (!item || !title || title === item.title) return;
        undoStack.push({ type: "rename", id, prevTitle: item.title, prevEdited: Boolean(item.titleEdited) });
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, title, titleEdited: true, updatedAt: Date.now() } : i)),
        }));
        toast("Renamed", { description: title, action: { label: "Undo", onClick: () => get().undo() } });
      },

      // ---- tags ----
      addTag: (id, raw) => {
        const tag = raw.trim().replace(/^#/, "").toLowerCase();
        if (!tag) return;
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id && !(i.tags || []).includes(tag) ? { ...i, tags: [...(i.tags || []), tag], updatedAt: Date.now() } : i
          ),
        }));
      },
      removeTag: (id, tag) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, tags: (i.tags || []).filter((t) => t !== tag), updatedAt: Date.now() } : i)) })),

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
          const added = typeof raw.added === "number" ? raw.added : Date.now();
          fresh.push({
            id: urlId(raw.url),
            url: raw.url,
            title: raw.title ? String(raw.title) : domain(raw.url),
            favicon: googleFav(raw.url),
            state: VALID_STATES.has(raw.state) ? raw.state : "inbox",
            added,
            updatedAt: Date.now(),
            loading: false,
            tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map((t) => String(t).toLowerCase()))] : [],
          });
        });
        if (fresh.length) set({ items: [...fresh.slice().reverse(), ...items] });
        let msg = fresh.length ? `Imported ${fresh.length} item${fresh.length > 1 ? "s" : ""}.` : "";
        if (dupes) msg += `${msg ? " " : ""}${dupes} duplicate${dupes > 1 ? "s" : ""} skipped.`;
        toast(msg || "Nothing new to import");
      },

      clearAll: () => {
        undoStack.length = 0;
        const now = Date.now();
        // Tombstone every item so the clear propagates instead of being undone by a remote merge.
        set((s) => ({
          tombstones: [
            ...s.tombstones.filter((t) => !s.items.some((i) => i.id === t.id)),
            ...s.items.map((i) => ({ id: i.id, deletedAt: now })),
          ],
          items: [],
          selId: null,
        }));
      },
    }),
    {
      name: "hoard",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items, tombstones: s.tombstones, view: s.view, sort: s.sort, detailsOpen: s.detailsOpen }),
    }
  )
  )
);
