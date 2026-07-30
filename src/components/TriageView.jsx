import { useEffect, useMemo, useRef, useState } from "react";
import { X, Archive, Clock, ChevronsRight, Tag, Pencil, ExternalLink, Trash2 } from "lucide-react";
import { domain } from "../lib/urls.js";
import { ago } from "../lib/time.js";
import { sortByAdded } from "../store.js";

// One link at a time, with the whole inbox behind it. The catalog is built for
// scanning a hoard you already know; this is for the pile you haven't looked at
// yet, where the only question is which of three places it belongs.
//
// Skipping is deliberately session-only — it isn't stored and it doesn't sync.
// "Saved for Later" is already the durable way to say "not now", so a skip that
// outlived the sitting would just be a second, vaguer version of it. Here it
// means "don't ask me again on this pass"; the item stays in the inbox and
// comes back next time.
export default function TriageView({ items, sort, onClose, onAct, onTag, onRename, onOpen, onUndo, onNeedMeta }) {
  const [skipped, setSkipped] = useState(() => new Set());
  // Counted rather than derived: a deleted item leaves `items` entirely, so
  // there's nothing left to look at afterwards to tell it apart from one that
  // was filed. Undo puts the link back in the queue, so it walks back too.
  const [deleted, setDeleted] = useState(0);
  // null when not renaming — an empty string is a legitimate draft.
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const cancelledRef = useRef(false);
  const rootRef = useRef(null);
  // The preview URL that 404'd, if any — a dead og:image should leave no trace
  // rather than a broken-image box in the middle of the card.
  const [failedImg, setFailedImg] = useState(null);

  // Opening from the header button leaves the caret on that button, which is
  // now behind a full-screen dialog: Tab would walk the catalog nobody can see,
  // and a space would try to press it. Take focus on the way in, the way the
  // stash modal and the tag editor do.
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);

  // What the pile was when we sat down, so the counter measures the sitting
  // rather than shrinking to "1 of 1" as it empties.
  const [total] = useState(() => items.filter((i) => i.state === "inbox").length);

  const queue = useMemo(
    () => sortByAdded(items.filter((i) => i.state === "inbox" && !skipped.has(i.id)), sort),
    [items, skipped, sort],
  );
  // Always the head of the queue: filing an item or skipping it takes it out,
  // and the next one moves up on its own. No cursor to keep in step.
  const item = queue[0];
  // Three different numbers, and they aren't interchangeable. `done` is how far
  // through the pile you are — a skip and a delete both advance it, and it's
  // what the counter and the bar measure. `filed` is how many actually went
  // somewhere, which is the only one the summary should claim credit for: a
  // deleted link didn't get filed, it got thrown away, and a skip is still
  // sitting in the inbox waiting.
  const done = Math.max(0, total - queue.length);
  const filed = Math.max(0, done - skipped.size - deleted);

  const startRename = () => setDraft(item.title);

  useEffect(() => {
    if (draft === null) return;
    cancelledRef.current = false;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [draft === null]);

  // A rename left open when the card moves on would land on the wrong item.
  useEffect(() => { setDraft(null); }, [item?.id]);

  // Anything stashed before descriptions existed has none, and a hoard doesn't
  // re-enrich itself. Fetch for the card actually in front of you: the pile
  // fills in as you work it, and nothing is fetched for links you never reach.
  // `undefined` means never looked; "" means looked and the page had nothing.
  //
  // The attempt is remembered here rather than inferred from the item, because
  // a lookup that fails leaves the item exactly as it found it — no description,
  // loading back to false — which reads identically to never having tried. That
  // sent it round again the moment the flag cleared, and again, in a loop that
  // only stopped when the card changed. One attempt per link per sitting; a
  // page that was simply unreachable gets another chance next time.
  const triedRef = useRef(new Set());
  useEffect(() => {
    if (!item || item.loading || item.description !== undefined) return;
    if (triedRef.current.has(item.id)) return;
    triedRef.current.add(item.id);
    onNeedMeta?.(item.id, item.url);
  }, [item?.id, item?.description, item?.loading]);

  function commitRename() {
    if (cancelledRef.current || draft === null || !item) return;
    onRename(item.id, draft);
    setDraft(null);
  }

  function skip() {
    if (!item) return;
    setSkipped((s) => new Set(s).add(item.id));
  }

  // What this sitting did, in order. The store's undo stack is older and wider
  // than this view — it may well be holding something from before triage
  // opened — so `u` can't just assume it reversed one of ours. Popping our own
  // log tells us whether the thing coming back was a delete, and the counts
  // walk back with it; an empty log means the undo reached past this sitting
  // and there's nothing of ours to adjust.
  const logRef = useRef([]);

  function decide(action) {
    if (!item) return;
    logRef.current.push(action);
    if (action === "delete") setDeleted((n) => n + 1);
    onAct(item.id, action);
  }

  function undoLast() {
    if (logRef.current.pop() === "delete") setDeleted((n) => Math.max(0, n - 1));
    onUndo();
  }

  useEffect(() => {
    function onKey(e) {
      // The tag editor and the rename field are both real inputs floating over
      // this view — while either has the caret, the letters are theirs.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Undo is the one key that has to work with the queue empty — the last
      // thing you filed is exactly what you're most likely to want back, and
      // the toast's button is gone within a few seconds.
      if (e.key === "u") { e.preventDefault(); undoLast(); return; }
      if (!item) return;
      switch (e.key) {
        case "a": e.preventDefault(); decide("archived"); break;
        case "s": e.preventDefault(); decide("later"); break;
        // No confirm, same as `d` on a row: the toast carries Undo, `u` works
        // in here, and a delete that stops the flow to ask defeats the point of
        // a pass through the pile.
        case "d": e.preventDefault(); decide("delete"); break;
        // Space only. `n` would be the obvious second key for "next", but it
        // means "stash a link" everywhere else in the app, and a letter that
        // quietly does something different in here is worse than one key.
        case " ": e.preventDefault(); skip(); break;
        case "t": e.preventDefault(); onTag(item.id); break;
        case "e": e.preventDefault(); startRename(); break;
        case "o": case "Enter": e.preventDefault(); onOpen(item.url); break;
        default: break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="triage" ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Triage inbox">
      <div className="triage-top">
        <span className="triage-eyebrow">Triage</span>
        {total > 0 && (
          <span className="triage-count" aria-live="polite">
            {item ? `${done + 1} of ${total}` : `${done} of ${total}`}
          </span>
        )}
        <button className="triage-close" aria-label="Leave triage" title="Leave triage (esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {total > 0 && (
        <div
          className="triage-progress"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Items triaged"
        >
          <span className="triage-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      {!item ? (
        <div className="triage-done">
          <span className="triage-done-line">
            {total === 0 ? "Nothing to triage." : "Inbox triaged."}
          </span>
          <span className="triage-done-how">
            {/* Not "press N to stash" — the global shortcuts are stood down
                while this is up, so the only honest instruction is the way out. */}
            {/* Each clause earns its place by being non-zero: "all 4 filed" on a
                clean sweep, and the qualifiers only when there's something to
                qualify. A skip is still in the inbox and a delete is gone —
                neither is filed, and rolling them together would overstate it. */}
            {total === 0
              ? <>press <kbd>esc</kbd> to head back</>
              : skipped.size || deleted
                ? [
                    `${filed} filed`,
                    deleted ? `${deleted} deleted` : null,
                    skipped.size ? `${skipped.size} skipped, still in your inbox` : null,
                  ].filter(Boolean).join(" · ")
                : <>all {filed} filed</>}
          </span>
          <button className="triage-leave" onClick={onClose}>Done</button>
        </div>
      ) : (
        <>
          <div className="triage-card">
            <div className="triage-site">
              <div className="fav-well triage-fav">
                <span className="fav-letter">{(domain(item.url)[0] || "?").toUpperCase()}</span>
                {item.favicon && (
                  <img className="fav" src={item.favicon} alt="" onError={(e) => { e.currentTarget.remove(); }} />
                )}
              </div>
              <div className="triage-site-meta">
                {draft !== null ? (
                  <input
                    ref={inputRef}
                    className="triage-title-input"
                    value={draft}
                    aria-label="Listing title"
                    autoComplete="off"
                    spellCheck="false"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelledRef.current = true;
                        setDraft(null);
                      }
                    }}
                  />
                ) : (
                  <h2 className="triage-title">{item.title}</h2>
                )}
                <span className="triage-domain">{domain(item.url)}</span>
              </div>
            </div>

            <button className="triage-open" onClick={() => onOpen(item.url)} title="Open link (o)">
              <ExternalLink size={15} />
              <span className="triage-open-url">{item.url}</span>
            </button>

            {/* What the sketch's empty middle is for: the page's own account of
                itself, which is the difference between deciding from a URL and
                deciding from the thing. */}
            <div className="triage-preview">
              {item.image && failedImg !== item.image && (
                <img
                  className="triage-image"
                  src={item.image}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImg(item.image)}
                />
              )}
              {item.description
                ? <p className="triage-description">{item.description}</p>
                : item.loading
                  ? <span className="triage-preview-none">reading the page…</span>
                  : item.description === "" && !item.image
                    ? <span className="triage-preview-none">no description on this one</span>
                    : null}
            </div>

            <div className="triage-meta">
              <span className="triage-added">stashed {ago(item.added)}</span>
              {item.tags && item.tags.length > 0 && (
                <div className="triage-tags">
                  {item.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                </div>
              )}
            </div>

            <div className="triage-edits">
              <button className="triage-edit" title="Edit tags (t)" onClick={() => onTag(item.id)}>
                <Tag size={15} /> Tag
              </button>
              <button className="triage-edit" title="Rename (e)" onClick={startRename}>
                <Pencil size={15} /> Edit
              </button>
            </div>
          </div>

          <div className="triage-decide">
            <div className="triage-decide-pair">
              <button className="triage-btn triage-archive" title="Archive (a)" onClick={() => decide("archived")}>
                <Archive size={16} /> Archive
              </button>
              <button className="triage-btn triage-later" title="Save for later (s)" onClick={() => decide("later")}>
                <Clock size={16} /> Save for Later
              </button>
            </div>
            {/* The two ways of not filing it, on their own line beneath the two
                that do. Skip keeps the width because it's the one you reach for
                often; delete is deliberately the smaller target of the pair. */}
            <div className="triage-decide-tail">
              <button className="triage-btn triage-skip" title="Skip for now (space)" onClick={skip}>
                <ChevronsRight size={16} /> Skip for Now
              </button>
              <button className="triage-btn triage-delete" title="Delete (d)" onClick={() => decide("delete")}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
