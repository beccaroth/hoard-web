import { useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  ChevronLeft, Download, Upload, Copy, FileText, Braces,
  Layers, Inbox, Clock, Archive, PanelLeft,
  Keyboard, Plus, X, ArrowDownWideNarrow, ArrowUpWideNarrow,
} from "lucide-react";
import Row from "./components/Row.jsx";
import RowActions from "./components/RowActions.jsx";
import TagEditor from "./components/TagEditor.jsx";
import AuthControl from "./components/AuthControl.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import SearchBox from "./components/SearchBox.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import { useHoard, selectVisible, parseQuery, matchesItem, sortByAdded, SECTIONS } from "./store.js";
import { initSync, whenSynced } from "./lib/sync.js";

const KEYS = [
  { k: ["j", "k"], lab: "move" }, { k: ["o"], lab: "open" }, { k: ["c"], lab: "copy" },
  { k: ["e"], lab: "rename" }, { k: ["r"], lab: "refresh" }, { k: ["t"], lab: "tag" },
  { k: ["s"], lab: "later" }, { k: ["a"], lab: "archive" }, { k: ["d"], lab: "delete" },
  { k: ["u"], lab: "undo" }, { k: ["1-4"], lab: "views" }, { k: ["⌘k"], lab: "palette" },
];

export default function App() {
  const items = useHoard((s) => s.items);
  const view = useHoard((s) => s.view);
  const tagFilter = useHoard((s) => s.tagFilter);
  const query = useHoard((s) => s.query);
  const sort = useHoard((s) => s.sort);
  const selId = useHoard((s) => s.selId);
  const folded = useHoard((s) => s.folded);
  const editingId = useHoard((s) => s.editingId);
  const renamingId = useHoard((s) => s.renamingId);
  const exportOpen = useHoard((s) => s.exportOpen);
  const status = useHoard((s) => s.status);

  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const [session, setSession] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [actionsId, setActionsId] = useState(null);

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
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    whenSynced(() => useHoard.getState().quickAdd({ url, title }));
  }, []);

  const visible = useMemo(() => selectVisible({ items, view, tagFilter, query, sort }), [items, view, tagFilter, query, sort]);
  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags || []))].sort(), [items]);
  const parsedQuery = useMemo(() => parseQuery(query, allTags), [query, allTags]);
  const editingItem = editingId ? items.find((i) => i.id === editingId) : null;
  const single = view !== "all";
  const countFor = (key) => (key === "all" ? items.length : items.filter((i) => i.state === key).length);

  // reflect folded state on <body> (drives the layout transition)
  useEffect(() => { document.body.classList.toggle("folded", folded); }, [folded]);

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

  // scroll the selection into view
  useEffect(() => {
    document.querySelector(".item.sel")?.scrollIntoView({ block: "nearest" });
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
        case "[": e.preventDefault(); s.toggleFolded(); break;
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

  // Escape closes the help / deposit overlays (local state isn't visible to the global handler above)
  useEffect(() => {
    if (!helpOpen && !depositOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (helpOpen) setHelpOpen(false);
      if (depositOpen) setDepositOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, depositOpen]);

  function fileFromTextarea() {
    const text = textareaRef.current?.value || "";
    useHoard.getState().addUrls(text);
    if (textareaRef.current) textareaRef.current.value = "";
    setDepositOpen(false);
  }
  function onTextareaKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); fileFromTextarea(); }
  }

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
          <button
            className="fold-btn"
            aria-label={folded ? "Show left panel" : "Hide left panel"}
            onClick={() => useHoard.getState().toggleFolded()}
          >
            <ChevronLeft size={14} strokeWidth={2.2} />
            <span className="fold-btn-tooltip" role="tooltip">
              {folded ? "Show left panel" : "Hide left panel"}
              <kbd>[</kbd>
            </span>
          </button>
          <img className="logo" src="/favicon.svg" alt="" />
          <h1>Hoard</h1>
        </div>
        <div className="header-right">
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
          <ThemeToggle />
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
        <aside className={"left" + (depositOpen ? " sheet-open" : "")}>
          <div className="panel-head">
            Deposit links
            <button
              className="sheet-close"
              aria-label="Close"
              onClick={() => setDepositOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="panel-note">
            Paste URLs — one per line, or any text with links in it. <kbd>⌘</kbd>+<kbd>↵</kbd> to file.
          </div>
          <textarea
            ref={textareaRef}
            spellCheck="false"
            placeholder={"https://example.com\nhttps://news.ycombinator.com\na paragraph with a link.tld inside it…"}
            onKeyDown={onTextareaKeyDown}
          />
          <div className="btn-row">
            <button className="btn-primary" onClick={fileFromTextarea}>File to Inbox</button>
            <button className="btn-ghost" onClick={clearAll}>Empty</button>
          </div>
          <div className="status">{status}</div>
        </aside>

        <section className="right">
          <div className="tabs">
            <div className="tabs-left">
              {[{ key: "all", label: "All", Icon: Layers, n: 1 }, { key: "inbox", label: "Inbox", Icon: Inbox, n: 2 },
                { key: "later", label: "Saved for Later", Icon: Clock, n: 3 }, { key: "archived", label: "Archived", Icon: Archive, n: 4 }].map((t) => (
                <button
                  key={t.key}
                  className={"tab" + (t.key === view ? " active" : "")}
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
              <SearchBox
                ref={searchRef}
                query={query}
                setQuery={(v) => useHoard.getState().setQuery(v)}
                allTags={allTags}
              />
            </div>
          </div>

          {(single ? SECTIONS.filter((s) => s.key === view) : SECTIONS).map((sec) => {
            const secItems = sortByAdded(
              items.filter((i) => i.state === sec.key && matchesItem(i, { tagFilter, ...parsedQuery })),
              sort,
            );
            if (!single && sec.key !== "inbox" && !secItems.length) return null;
            return (
              <div key={sec.key}>
                {!single && (
                  <div className="section-title">
                    <span className="name">{sec.label}</span>
                    <span className="count">{secItems.length}</span>
                  </div>
                )}
                {secItems.length === 0
                  ? <div className="empty">Nothing here yet.</div>
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
                        onLongPress={() => setActionsId(i.id)}
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
            { id: "v-all", label: "Go to All", hint: "1", icon: <Layers size={16} />, run: () => useHoard.getState().setView("all") },
            { id: "v-inbox", label: "Go to Inbox", hint: "2", icon: <Inbox size={16} />, run: () => useHoard.getState().setView("inbox") },
            { id: "v-later", label: "Go to Saved for Later", hint: "3", icon: <Clock size={16} />, run: () => useHoard.getState().setView("later") },
            { id: "v-arch", label: "Go to Archived", hint: "4", icon: <Archive size={16} />, run: () => useHoard.getState().setView("archived") },
            { id: "fold", label: "Toggle sidebar", hint: "[", icon: <PanelLeft size={16} />, run: () => useHoard.getState().toggleFolded() },
            { id: "x-urls", label: "Copy URLs (current view)", icon: <Copy size={16} />, run: () => exportAs("copy-urls") },
            { id: "x-md", label: "Copy as Markdown (current view)", icon: <FileText size={16} />, run: () => exportAs("copy-md") },
            { id: "x-json", label: "Download .json (current view)", icon: <Braces size={16} />, run: () => exportAs("json") },
            { id: "import", label: "Import .json…", icon: <Upload size={16} />, run: () => fileRef.current?.click() },
          ]}
          onRunItem={(i) => { window.open(i.url, "_blank"); useHoard.getState().setSelId(i.id); }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      <button
        className={"deposit-fab" + (depositOpen ? " hidden" : "")}
        aria-label="Add links"
        onClick={() => setDepositOpen(true)}
      >
        <Plus size={22} strokeWidth={2.4} />
      </button>

      {depositOpen && (
        <div className="sheet-backdrop" onClick={() => setDepositOpen(false)} />
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

      <Toaster position="bottom-center" theme="dark" toastOptions={{ style: { fontFamily: "var(--sans)" } }} />
    </>
  );
}
