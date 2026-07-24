import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Toaster, toast } from "sonner";
import {
  Download, Upload, Copy, FileText, Braces,
  Layers, Inbox, Clock, Archive, Trash2,
  Keyboard, Plus, X, ArrowDownWideNarrow, ArrowUpWideNarrow, Search,
} from "lucide-react";
import Row from "./components/Row.jsx";
import RowActions from "./components/RowActions.jsx";
import TagEditor from "./components/TagEditor.jsx";
import AuthControl from "./components/AuthControl.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import SearchBox from "./components/SearchBox.jsx";
import StashModal from "./components/StashModal.jsx";
import ThemeToggle, { readTheme } from "./components/ThemeToggle.jsx";
import { useHoard, selectVisible, parseQuery, matchesItem, sortByAdded, SECTIONS } from "./store.js";
import { normalizeUrl } from "./lib/urls.js";
import { initSync, whenSynced } from "./lib/sync.js";

const KEYS = [
  { k: ["n"], lab: "stash" }, { k: ["j", "k"], lab: "move" }, { k: ["o"], lab: "open" },
  { k: ["c"], lab: "copy" }, { k: ["e"], lab: "rename" }, { k: ["r"], lab: "refresh" },
  { k: ["t"], lab: "tag" }, { k: ["s"], lab: "later" }, { k: ["a"], lab: "archive" },
  { k: ["d"], lab: "delete" }, { k: ["u"], lab: "undo" }, { k: ["1-4"], lab: "views" },
  { k: ["⌘k"], lab: "search" },
];

// An empty view should name the thing that fills it rather than shrug.
const EMPTY = {
  inbox:    { line: "Your inbox is clear.",      how: <>press <kbd>N</kbd> to stash a link</> },
  later:    { line: "Nothing saved for later.",  how: <>press <kbd>S</kbd> on a link to keep it here</> },
  archived: { line: "Nothing archived yet.",     how: <>press <kbd>A</kbd> on a link to file it here</> },
};
const EMPTY_HOARD = { line: "The hoard is empty.", how: <>press <kbd>N</kbd> to stash your first link</> };

// The bookmarklet opens a tab purely to hand a link over, and until now that
// tab just sat there — stash ten things and you have ten Hoard tabs. It can
// close itself, but not before the link is actually safe: the push to Supabase
// is debounced 800ms and then takes a round-trip, so closing on a timer would
// strand the item in this browser's localStorage. So we wait for a sync that
// completes *after* the add (syncState is already "synced" from the sign-in
// pull, hence the lastSyncAt comparison), and if it errors or never lands we
// deliberately leave the tab open — it's the thing that will retry.
const CLOSE_MIN_VISIBLE_MS = 1000; // long enough to read the confirmation
const CLOSE_GIVE_UP_MS = 8000;

function closeWhenSafe({ needsPush }) {
  const addedAt = Date.now();
  const closeSoon = () =>
    setTimeout(() => window.close(), Math.max(0, CLOSE_MIN_VISIBLE_MS - (Date.now() - addedAt)));

  const settled = () => {
    const { syncState, lastSyncAt } = useHoard.getState();
    // "idle" means no account or no Supabase configured — nothing to wait for.
    if (syncState === "idle") return true;
    return syncState === "synced" && (lastSyncAt || 0) > addedAt;
  };

  // A duplicate changes nothing, so there's no push to wait on.
  if (!needsPush || settled()) { closeSoon(); return; }

  const unsub = useHoard.subscribe(
    (s) => [s.syncState, s.lastSyncAt].join(":"),
    () => { if (settled()) { unsub(); clearTimeout(giveUp); closeSoon(); } },
  );
  const giveUp = setTimeout(unsub, CLOSE_GIVE_UP_MS);
}

export default function App() {
  const items = useHoard((s) => s.items);
  const view = useHoard((s) => s.view);
  const tagFilter = useHoard((s) => s.tagFilter);
  const query = useHoard((s) => s.query);
  const sort = useHoard((s) => s.sort);
  const selId = useHoard((s) => s.selId);
  const editingId = useHoard((s) => s.editingId);
  const renamingId = useHoard((s) => s.renamingId);
  const exportOpen = useHoard((s) => s.exportOpen);

  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const [session, setSession] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [actionsId, setActionsId] = useState(null);
  // On phones the search field folds into an icon so the view tabs keep the
  // strip; opening it expands the field across the whole row.
  const [searchOpen, setSearchOpen] = useState(false);
  // Held here rather than inside the toggle so the toaster can wear the same
  // theme — it was pinned dark, which looked wrong on the light palette.
  const [theme, setTheme] = useState(readTheme);

  // auth + cross-device sync (no-op if Supabase env isn't configured)
  useEffect(() => initSync(setSession), []);

  // Incoming link from the bookmarklet / iOS shortcut: ?add=<url>&title=<title>.
  // File it only once sync settles so a sign-in pull can't clobber it, then
  // strip the params so a refresh doesn't re-file the same link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("add") || params.get("url");
    if (!url) return;
    const title = params.get("title") || "";
    // Only a script-opened window may close itself, which is exactly the
    // bookmarklet's tab. The iOS Shortcut navigates Safari here instead, so it
    // has no opener and the tab correctly stays put.
    const fromBookmarklet = Boolean(window.opener);
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    whenSynced(() => {
      const filed = useHoard.getState().quickAdd({ url, title });
      if (fromBookmarklet) closeWhenSafe({ needsPush: filed });
    });
  }, []);

  const visible = useMemo(() => selectVisible({ items, view, tagFilter, query, sort }), [items, view, tagFilter, query, sort]);
  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags || []))].sort(), [items]);
  const parsedQuery = useMemo(() => parseQuery(query, allTags), [query, allTags]);
  const editingItem = editingId ? items.find((i) => i.id === editingId) : null;
  const single = view !== "all";
  const countFor = (key) => (key === "all" ? items.length : items.filter((i) => i.state === key).length);
  // The modal needs the dedupe keys to say what it will skip before you commit.
  const existingUrls = useMemo(() => new Set(items.map((i) => normalizeUrl(i.url))), [items]);

  // keep selection valid + default to first visible item
  useEffect(() => {
    const { setSelId } = useHoard.getState();
    if (selId && !visible.some((i) => i.id === selId)) setSelId(visible[0]?.id ?? null);
    else if (!selId && visible.length) setSelId(visible[0].id);
  }, [visible, selId]);

  // a row that scrolls out of the current view (filtered, moved, deleted) can't
  // stay in rename mode — its input is gone
  useEffect(() => {
    if (renamingId && !visible.some((i) => i.id === renamingId)) useHoard.getState().setRenamingId(null);
  }, [visible, renamingId]);

  // Scroll the selection into view, and take focus with it — but only when
  // focus is already inside the catalog. Moving it unconditionally would yank
  // the caret out of the search box on every j/k.
  useEffect(() => {
    const row = document.querySelector(".item.sel");
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    const active = document.activeElement;
    const focusInList = active && active !== document.body && active.closest(".right");
    if (focusInList && !row.contains(active)) row.focus({ preventScroll: true });
  }, [selId]);

  // close export menu on outside click
  useEffect(() => {
    function onDoc(e) { if (!e.target.closest(".export-wrap")) useHoard.getState().setExportOpen(false); }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // global keyboard — bound once; reads live state via getState()
  useEffect(() => {
    function onKey(e) {
      // ⌘K / Ctrl+K toggles the palette from anywhere (even inputs)
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const tag = document.activeElement.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setStashOpen(true); return; }
      const s = useHoard.getState();
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); s.moveSel(1); break;
        case "k": case "ArrowUp": e.preventDefault(); s.moveSel(-1); break;
        case "o": case "Enter": e.preventDefault(); s.act("open"); break;
        case "c": e.preventDefault(); s.copyUrl(); break;
        case "e": e.preventDefault(); if (s.selId) s.setRenamingId(s.selId); break;
        case "r": e.preventDefault(); if (s.selId) s.refresh(s.selId); break;
        case "s": e.preventDefault(); s.act("later"); break;
        case "a": e.preventDefault(); s.act("archived"); break;
        case "d": e.preventDefault(); s.act("delete"); break;
        case "t": e.preventDefault(); if (s.selId) s.setEditingId(s.selId); break;
        case "u": e.preventDefault(); s.undo(); break;
        case "1": e.preventDefault(); s.setView("all"); break;
        case "2": e.preventDefault(); s.setView("inbox"); break;
        case "3": e.preventDefault(); s.setView("later"); break;
        case "4": e.preventDefault(); s.setView("archived"); break;
        case "Escape":
          if (s.exportOpen) s.setExportOpen(false);
          else if (s.editingId) s.setEditingId(null);
          else if (s.renamingId) s.setRenamingId(null);
          else if (s.tagFilter) s.clearTagFilter();
          break;
        default: break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes the help overlay (local state isn't visible to the global handler above)
  useEffect(() => {
    if (!helpOpen) return;
    function onKey(e) { if (e.key === "Escape") setHelpOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  // ---- export / import (browser IO stays in the component) ----
  function download(filename, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function exportAs(fmt) {
    useHoard.getState().setExportOpen(false);
    const list = visible;
    if (!list.length) { toast("Nothing to export"); return; }
    const n = list.length;
    const plural = n > 1 ? "s" : "";
    try {
      if (fmt === "copy-urls") {
        await navigator.clipboard.writeText(list.map((i) => i.url).join("\n"));
        toast(`Copied ${n} URL${plural}`);
      } else if (fmt === "copy-md") {
        await navigator.clipboard.writeText(list.map((i) => `- [${i.title}](${i.url})`).join("\n"));
        toast(`Copied ${n} link${plural} as Markdown`);
      } else if (fmt === "txt") {
        download("hoard.txt", list.map((i) => i.url).join("\n") + "\n", "text/plain");
        toast(`Downloaded ${n} URL${plural}`);
      } else if (fmt === "json") {
        const clean = list.map(({ url, title, state, tags, added }) => ({ url, title, state, tags, added }));
        download("hoard.json", JSON.stringify(clean, null, 2), "application/json");
        toast(`Downloaded ${n} item${plural}`);
      }
    } catch {
      toast("Couldn't copy — clipboard blocked");
    }
  }
  function onImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { useHoard.getState().importItems(JSON.parse(reader.result)); }
      catch { toast("Couldn't read that file — invalid JSON"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }
  function clearAll() {
    if (confirm("Empty the entire hoard?")) useHoard.getState().clearAll();
  }

  return (
    <>
      <header>
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <h1>Hoard</h1>
        </div>
        <div className="header-right">
          <button className="stash-btn" onClick={() => setStashOpen(true)}>
            ＋ Stash Link <kbd>N</kbd>
          </button>
          <div className="legend">
            {KEYS.map((p) => (
              <span className="pair" key={p.lab}>
                {p.k.map((k) => <kbd key={k}>{k}</kbd>)}
                <span className="lab">{p.lab}</span>
              </span>
            ))}
          </div>
          <button
            className="btn-ghost icon-btn legend-trigger"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setHelpOpen(true)}
          >
            <Keyboard size={15} />
          </button>
          <ThemeToggle theme={theme} onChange={setTheme} />
          <AuthControl session={session} />
          <div className="export-wrap">
            <button className="btn-ghost icon-btn" title="Export current view"
              onClick={(e) => { e.stopPropagation(); useHoard.getState().setExportOpen(!exportOpen); }}>
              <Download size={15} /> Export
            </button>
            <div className={"menu" + (exportOpen ? " show" : "")}>
              <button onClick={() => exportAs("copy-urls")}><Copy size={15} /> Copy URLs</button>
              <button onClick={() => exportAs("copy-md")}><FileText size={15} /> Copy as Markdown</button>
              <div className="sep" />
              <button onClick={() => exportAs("txt")}><FileText size={15} /> Download .txt</button>
              <button onClick={() => exportAs("json")}><Braces size={15} /> Download .json</button>
              <div className="sep" />
              <button onClick={() => { useHoard.getState().setExportOpen(false); fileRef.current?.click(); }}><Upload size={15} /> Import .json…</button>
            </div>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
          </div>
        </div>
      </header>

      <main>
        <section className="right">
          <div className={"tabs" + (searchOpen ? " searching" : "")}>
            <div className="tabs-left">
              {[{ key: "all", label: "All", Icon: Layers, n: 1 }, { key: "inbox", label: "Inbox", Icon: Inbox, n: 2 },
                { key: "later", label: "Saved for Later", Icon: Clock, n: 3 }, { key: "archived", label: "Archived", Icon: Archive, n: 4 }].map((t) => (
                <button
                  key={t.key}
                  className={"tab" + (t.key === view ? " active" : "")}
                  // the active view was conveyed only by colour + underline;
                  // expose it to assistive tech too
                  aria-current={t.key === view ? "page" : undefined}
                  title={`${t.label} (${t.n})`}
                  onClick={() => useHoard.getState().setView(t.key)}
                >
                  <t.Icon size={14} /> {t.label}<span className="n">{countFor(t.key)}</span>
                </button>
              ))}
            </div>
            <div className="tabs-right">
              {tagFilter && (
                <button className="tab tagf" onClick={() => useHoard.getState().clearTagFilter()}>
                  #{tagFilter}<span className="x">×</span>
                </button>
              )}
              <button
                className="tab sort-toggle"
                title={sort === "newest" ? "Newest first — click to flip" : "Oldest first — click to flip"}
                aria-label={`Sort by date added: ${sort} first`}
                onClick={() => useHoard.getState().toggleSort()}
              >
                {sort === "newest"
                  ? <ArrowDownWideNarrow size={14} />
                  : <ArrowUpWideNarrow size={14} />}
                <span className="sort-label">{sort === "newest" ? "Newest" : "Oldest"}</span>
              </button>
              {/* Phone-only: the magnifier expands the field; Cancel folds it
                  back. Both are hidden on wider screens, where the field is
                  always open. */}
              <button
                className="tab search-toggle"
                aria-label="Search"
                aria-expanded={searchOpen}
                /* Flush the expand synchronously so the field is on-screen and
                   we can focus it inside the same tap — iOS only raises the
                   keyboard for a focus that happens within the gesture. */
                onClick={() => { flushSync(() => setSearchOpen(true)); searchRef.current?.focus(); }}
              >
                <Search size={14} />
              </button>
              <SearchBox
                ref={searchRef}
                query={query}
                setQuery={(v) => useHoard.getState().setQuery(v)}
                allTags={allTags}
              />
              <button
                className="tab search-close"
                aria-label="Close search"
                onClick={() => { useHoard.getState().setQuery(""); setSearchOpen(false); }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {(single ? SECTIONS.filter((s) => s.key === view) : SECTIONS).map((sec) => {
            const secItems = sortByAdded(
              items.filter((i) => i.state === sec.key && matchesItem(i, { tagFilter, ...parsedQuery })),
              sort,
            );
            if (!single && sec.key !== "inbox" && !secItems.length) return null;
            return (
              <div key={sec.key} role="list" aria-label={sec.label}>
                {!single && (
                  <div className="section-title">
                    <span className="name">{sec.label}</span>
                    <span className="rule" />
                    <span className="count">{String(secItems.length).padStart(2, "0")}</span>
                  </div>
                )}
                {secItems.length === 0
                  ? (() => {
                      // A filtered-to-nothing view is a different situation from
                      // an empty one — don't tell someone to press N when what
                      // they need is to clear the search.
                      const filtered = Boolean(query || tagFilter);
                      const copy = filtered
                        ? { line: "Nothing matches that.", how: <>press <kbd>esc</kbd> to clear the filter</> }
                        : items.length === 0 && sec.key === "inbox"
                          ? EMPTY_HOARD
                          : EMPTY[sec.key];
                      return (
                        <div className="empty">
                          <span className="empty-line">{copy.line}</span>
                          <span className="empty-how">{copy.how}</span>
                        </div>
                      );
                    })()
                  : secItems.map((i) => (
                      <Row
                        key={i.id}
                        item={i}
                        selected={i.id === selId}
                        tagFilter={tagFilter}
                        renaming={i.id === renamingId}
                        onSelect={() => useHoard.getState().setSelId(i.id)}
                        onOpen={() => window.open(i.url, "_blank")}
                        onFilterTag={(t) => useHoard.getState().toggleTagFilter(t)}
                        onRefresh={() => useHoard.getState().refresh(i.id)}
                        onRenameStart={() => useHoard.getState().setRenamingId(i.id)}
                        onRenameCommit={(title) => {
                          useHoard.getState().renameItem(i.id, title);
                          useHoard.getState().setRenamingId(null);
                        }}
                        onRenameCancel={() => useHoard.getState().setRenamingId(null)}
                        onSwipe={(action) => {
                          useHoard.getState().setSelId(i.id);
                          if (action === "tag") { useHoard.getState().setEditingId(i.id); return; }
                          useHoard.getState().act(action);
                        }}
                        onActions={() => setActionsId(i.id)}
                      />
                    ))}
              </div>
            );
          })}
        </section>
      </main>

      {editingItem && (
        <TagEditor
          item={editingItem}
          allTags={allTags}
          onAdd={(id, raw) => useHoard.getState().addTag(id, raw)}
          onRemove={(id, tag) => useHoard.getState().removeTag(id, tag)}
          onClose={() => useHoard.getState().setEditingId(null)}
        />
      )}

      {actionsId && (() => {
        const it = items.find((x) => x.id === actionsId);
        if (!it) return null;
        return (
          <RowActions
            item={it}
            onClose={() => setActionsId(null)}
            onOpen={() => { window.open(it.url, "_blank"); setActionsId(null); }}
            onTag={() => {
              useHoard.getState().setEditingId(it.id);
              setActionsId(null);
            }}
            onRename={() => {
              useHoard.getState().setSelId(it.id);
              useHoard.getState().setRenamingId(it.id);
              setActionsId(null);
            }}
            onRefresh={() => {
              useHoard.getState().refresh(it.id);
              setActionsId(null);
            }}
            onMove={(state) => {
              useHoard.getState().setSelId(it.id);
              useHoard.getState().act(state);
              setActionsId(null);
            }}
            onDelete={() => {
              useHoard.getState().setSelId(it.id);
              useHoard.getState().act("delete");
              setActionsId(null);
            }}
          />
        );
      })()}

      {paletteOpen && (
        <CommandPalette
          items={items}
          commands={[
            { id: "stash", label: "Stash links…", hint: "n", icon: <Plus size={16} />, run: () => setStashOpen(true) },
            { id: "v-all", label: "Go to All", hint: "1", icon: <Layers size={16} />, run: () => useHoard.getState().setView("all") },
            { id: "v-inbox", label: "Go to Inbox", hint: "2", icon: <Inbox size={16} />, run: () => useHoard.getState().setView("inbox") },
            { id: "v-later", label: "Go to Saved for Later", hint: "3", icon: <Clock size={16} />, run: () => useHoard.getState().setView("later") },
            { id: "v-arch", label: "Go to Archived", hint: "4", icon: <Archive size={16} />, run: () => useHoard.getState().setView("archived") },
            { id: "x-urls", label: "Copy URLs (current view)", icon: <Copy size={16} />, run: () => exportAs("copy-urls") },
            { id: "x-md", label: "Copy as Markdown (current view)", icon: <FileText size={16} />, run: () => exportAs("copy-md") },
            { id: "x-json", label: "Download .json (current view)", icon: <Braces size={16} />, run: () => exportAs("json") },
            { id: "import", label: "Import .json…", icon: <Upload size={16} />, run: () => fileRef.current?.click() },
            // Emptying the hoard lost its button with the deposit panel; it's
            // destructive and rare, so the palette is the right home for it.
            { id: "empty", label: "Empty the hoard…", icon: <Trash2 size={16} />, run: clearAll },
          ]}
          onRunItem={(i) => { window.open(i.url, "_blank"); useHoard.getState().setSelId(i.id); }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      <button
        className={"stash-fab" + (stashOpen ? " hidden" : "")}
        aria-label="Stash a link"
        onClick={() => setStashOpen(true)}
      >
        <Plus size={22} strokeWidth={2.4} />
      </button>

      {stashOpen && (
        <StashModal
          existingUrls={existingUrls}
          onStash={(text) => useHoard.getState().addUrls(text)}
          onClose={() => setStashOpen(false)}
        />
      )}

      {helpOpen && (
        <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
            <div className="help-head">
              <span>Keyboard shortcuts</span>
              <button
                className="help-close"
                aria-label="Close"
                onClick={() => setHelpOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="help-list">
              {KEYS.map((p) => (
                <div className="help-row" key={p.lab}>
                  <div className="help-keys">
                    {p.k.map((k) => <kbd key={k}>{k}</kbd>)}
                  </div>
                  <div className="help-lab">{p.lab}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right keeps toasts clear of the tag editor, which docks
          bottom-centre. Styling lives in styles.css so it reads from the
          theme tokens rather than being frozen into inline styles. */}
      <Toaster position="bottom-right" theme={theme} />
    </>
  );
}
