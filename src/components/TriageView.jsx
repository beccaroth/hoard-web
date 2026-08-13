import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, Archive, Clock, ChevronsRight, Tag, Pencil, ExternalLink, Trash2,
  ChevronLeft, ChevronRight, Undo2,
} from "lucide-react";
import { domain } from "../lib/urls.js";
import { ago } from "../lib/time.js";
import { sortByAdded } from "../store.js";

// One link at a time, with the whole inbox behind it. The catalog is built for
// scanning a hoard you already know; this is for the pile you haven't looked at
// yet, where the only question is which of three places it belongs.
//
// The pass is a line you can walk in both directions. Every card that comes up
// is written down in `visited`, in the order it appeared, and the cursor `pos`
// says where along that line you're standing — so back is a step, not a guess.
// Undo can't do this job on its own: it reverses the last thing that touched
// the store, which may well be a rename you made on this card, or something
// from before triage opened, and a skip never enters the stack at all. Those
// are all reasons the previous card wouldn't come back. Walking the line is
// answerable to nothing but where you've been.
//
// Skipping is deliberately session-only — it isn't stored and it doesn't sync.
// "Saved for Later" is already the durable way to say "not now", so a skip that
// outlived the sitting would just be a second, vaguer version of it. Here it
// means "don't ask me again on this pass"; the item stays in the inbox and
// comes back next time.
export default function TriageView({ items, sort, onClose, onAct, onTag, onRename, onOpen, onUndo, onRestore, onNeedMeta }) {
  // The line, and where you are on it. `pos === visited.length` is the far end:
  // nothing left in hand, which is the done screen.
  const [visited, setVisited] = useState([]);
  const [pos, setPos] = useState(0);
  // id -> what this sitting did with it: "archived" | "later" | "delete" | "skip".
  // A card with no entry is one you haven't answered yet. Re-deciding overwrites,
  // so the counts below can't drift from what the queue actually shows.
  const [outcomes, setOutcomes] = useState({});
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

  const visitedSet = useMemo(() => new Set(visited), [visited]);
  // What hasn't come up yet. A card leaves this pool the moment it's shown, so
  // filing it, skipping it, or walking back to it can't put it in line twice.
  const pool = useMemo(
    () => sortByAdded(items.filter((i) => i.state === "inbox" && !visitedSet.has(i.id)), sort),
    [items, visitedSet, sort],
  );

  // Standing at the end of the line: take the next one off the pile.
  useEffect(() => {
    if (pos < visited.length) return;
    const next = pool[0];
    if (next) setVisited((v) => (v.includes(next.id) ? v : [...v, next.id]));
  }, [pos, visited.length, pool]);

  const currentId = visited[pos];
  const live = useMemo(() => items.find((i) => i.id === currentId), [items, currentId]);

  // A deleted link is out of `items` entirely, but it's still a place on the
  // line and walking back to a blank would be its own bug — so every card that
  // comes up leaves a copy behind to render from if the original goes.
  const shotsRef = useRef(new Map());
  useEffect(() => { if (live) shotsRef.current.set(live.id, live); }, [live]);
  const item = live || (currentId ? shotsRef.current.get(currentId) : undefined);
  const gone = Boolean(item) && !live;

  const outcome = currentId ? outcomes[currentId] : undefined;
  const OUTCOME_LABEL = { archived: "Archived", later: "Saved for later", delete: "Deleted", skip: "Skipped" };

  // How far along the line you're standing, which is what both the counter and
  // the bar report — they sit a few pixels apart and would look broken saying
  // different things. The bar used to measure answered links instead: identical
  // on a straight pass, since every card you leave behind gets an outcome, but
  // frozen while you walked back and forth, which read as a dead control.
  // Clamped because `total` was taken when we sat down and a sync can drop new
  // links into the inbox mid-sitting.
  const walked = Math.min(pos, total);

  // What the sitting did, which is a different question from how far through it
  // got, and only the summary asks it. `filed` is the one it can claim credit
  // for: a deleted link didn't get filed, it got thrown away, and a skip is
  // still sitting in the inbox waiting.
  const tally = Object.values(outcomes);
  const deleted = tally.filter((o) => o === "delete").length;
  const skipped = tally.filter((o) => o === "skip").length;
  const filed = tally.length - deleted - skipped;

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
  useEffect(() => { setDraft(null); }, [currentId]);

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
    if (!live || live.loading || live.description !== undefined) return;
    if (triedRef.current.has(live.id)) return;
    triedRef.current.add(live.id);
    onNeedMeta?.(live.id, live.url);
  }, [live?.id, live?.description, live?.loading]);

  // What this sitting sent to the store, in order. The store's undo stack is
  // older and wider than this view — it may well be holding something from
  // before triage opened — so `u` can't assume it reversed one of ours. Popping
  // our own log tells us what came back and where it lives on the line; an empty
  // log means the undo reached past this sitting and there's nothing to walk to.
  // Renames are logged too, because they go on the same stack: without them the
  // log would answer for a filing while the store reversed a title.
  const logRef = useRef([]);

  function commitRename() {
    if (cancelledRef.current || draft === null || !item) return;
    // Mirrors the store's own guard, so the log only grows when the stack does.
    const title = draft.trim();
    if (title && title !== item.title) logRef.current.push({ kind: "rename", id: item.id });
    onRename(item.id, draft);
    setDraft(null);
  }

  function mark(id, value) {
    setOutcomes((o) => ({ ...o, [id]: value }));
  }

  function decide(action) {
    if (!item || gone) return;
    logRef.current.push({ kind: "decide", id: currentId });
    mark(currentId, action);
    onAct(currentId, action);
    setPos((p) => p + 1);
  }

  function skip() {
    if (!item) return;
    mark(currentId, "skip");
    setPos((p) => p + 1);
  }

  // Back is the whole point: one step along the line, no matter what put you
  // here. It changes nothing about the link — a card you archived is still
  // archived when you land on it, wearing a badge that says so, and deciding
  // again from there just files it somewhere else.
  const canBack = pos > 0;
  function back() { setPos((p) => Math.max(0, p - 1)); }

  // Forward is the mirror of it, with one wrinkle: moving on from a card you
  // haven't answered is exactly what skip already means, so it says so rather
  // than inventing a second, unnamed way to leave a link undecided. Without
  // that, walking past one would leave it in the inbox and out of the count,
  // and the summary would quietly under-report the pile it left behind.
  function forward() {
    if (!item) return;
    if (!outcome) skip();
    else setPos((p) => p + 1);
  }

  // A deleted card's way back. Undo would do it too, but only while the delete
  // is still on top of the stack — this works whenever you walk to it.
  function restore() {
    if (!gone || !item) return;
    onRestore?.(item);
    setOutcomes((o) => { const next = { ...o }; delete next[item.id]; return next; });
  }

  function undoLast() {
    const last = logRef.current.pop();
    onUndo();
    if (!last) return;
    // A reversed filing leaves the link unanswered again; a reversed rename
    // never touched where it lives.
    if (last.kind === "decide") {
      setOutcomes((o) => { const next = { ...o }; delete next[last.id]; return next; });
    }
    const idx = visited.indexOf(last.id);
    if (idx !== -1) setPos(idx);
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
      // Both arrows work on the done screen too: walking back into the pass you
      // just finished is the most likely reason to reach for them there.
      if (e.key === "ArrowLeft") { e.preventDefault(); back(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); forward(); return; }
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
        case "e": e.preventDefault(); if (!gone) startRename(); break;
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
        <div className="triage-nav">
          <button
            className="triage-nav-btn"
            onClick={back}
            disabled={!canBack}
            aria-label="Previous link"
            title="Previous link (←)"
          >
            <ChevronLeft size={16} />
          </button>
          {total > 0 && (
            <span className="triage-count" aria-live="polite">
              {item ? `${Math.min(pos + 1, total)} of ${total}` : `${walked} of ${total}`}
            </span>
          )}
          <button
            className="triage-nav-btn"
            onClick={forward}
            disabled={!item}
            aria-label="Next link"
            title="Next link (→)"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button className="triage-close" aria-label="Leave triage" title="Leave triage (esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {total > 0 && (
        <div
          className="triage-progress"
          role="progressbar"
          aria-valuenow={walked}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Progress through the inbox"
        >
          <span className="triage-progress-fill" style={{ width: `${(walked / total) * 100}%` }} />
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
              : skipped || deleted
                ? [
                    `${filed} filed`,
                    deleted ? `${deleted} deleted` : null,
                    skipped ? `${skipped} skipped, still in your inbox` : null,
                  ].filter(Boolean).join(" · ")
                : <>all {filed} filed</>}
          </span>
          {canBack && (
            <button className="triage-back-in" onClick={back}>
              <ChevronLeft size={15} /> Back to the last one
            </button>
          )}
          <button className="triage-leave" onClick={onClose}>Done</button>
        </div>
      ) : (
        <>
          <div className={"triage-card" + (outcome ? " is-past" : "")}>
            {/* A card you've already answered shouldn't look like one you
                haven't — the badge is what tells you you've walked back into
                the part of the pass that's done. */}
            {outcome && (
              <div className={"triage-verdict verdict-" + outcome}>
                <span className="triage-verdict-dot" aria-hidden="true" />
                {OUTCOME_LABEL[outcome]}
              </div>
            )}

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

            {/* Nothing to edit on a link that isn't there any more. */}
            {!gone && (
              <div className="triage-edits">
                <button className="triage-edit" title="Edit tags (t)" onClick={() => onTag(item.id)}>
                  <Tag size={15} /> Tag
                </button>
                <button className="triage-edit" title="Rename (e)" onClick={startRename}>
                  <Pencil size={15} /> Edit
                </button>
              </div>
            )}
          </div>

          {gone ? (
            <div className="triage-decide">
              <button className="triage-btn triage-restore" onClick={restore}>
                <Undo2 size={16} /> Put it back in the inbox
              </button>
            </div>
          ) : (
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
          )}
        </>
      )}
    </div>
  );
}
