import { useEffect, useRef, useState } from "react";
import { RotateCw, Pencil, Clock, Archive, Tag, Trash2, MoreHorizontal } from "lucide-react";
import { domain } from "../lib/urls.js";
import { ago } from "../lib/time.js";

// The bit of the URL that isn't the hostname — shown only on the selected row,
// since a truncated path told you nothing the domain didn't.
function pathOf(url) {
  try {
    const u = new URL(url);
    const rest = u.pathname.replace(/\/$/, "") + u.search;
    return rest && rest !== "/" ? rest : "";
  } catch {
    return "";
  }
}

// Swipe thresholds as a fraction of the row width: short commit fires the
// primary action, long commit the secondary. Measured per-gesture so the feel
// stays consistent across phone sizes and orientations. The long threshold is
// capped so it never becomes an unreachable drag on the widest mobile widths.
const COMMIT_FRAC = 0.22;
const LONG_COMMIT_FRAC = 0.5;
const LONG_COMMIT_MAX_PX = 260;
const SWIPE_THRESH = 10;
const LONG_PRESS_MS = 500;
const PRESS_VISUAL_MS = 200;

// About what the row's tag column has ever had room for — three chips is what
// the strip's 280px holds on a desktop row, and what a phone's tag line holds
// before it becomes a tag cloud. Past that they collapse behind a +N that names
// them in its tooltip and expands the rest in place: hidden is fine,
// unreachable isn't, since the chips are also how you filter.
const COMPACT_TAGS = 3;

// Gestures key off the input device, not the window width: a tablet is wide
// enough for the two-pane layout but still has no hover and no keyboard, so it
// needs the same swipe / long-press affordances as a phone.
function isTouch() {
  return typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export default function Row({
  item, selected, tagFilter, renaming,
  onSelect, onOpen, onFilterTag, onRefresh, onSwipe, onActions,
  onRenameStart, onRenameCommit, onRenameCancel,
}) {
  const innerRef = useRef(null);
  const bgRef = useRef(null);
  const nameRef = useRef(null);
  const cancelledRef = useRef(false);
  const [draft, setDraft] = useState(item.title);
  const [tagsOpen, setTagsOpen] = useState(false);
  const t = useRef({
    x0: 0, y0: 0, dx: 0, dy: 0, t0: 0,
    swiping: false, longPressTimer: null, pressVisualTimer: null, suppressClick: false,
  });

  // Entering rename mode seeds the field from the current title and selects it,
  // so typing replaces and clicking lands the caret where you clicked. The
  // focus/select is deferred a frame: when rename starts from the pencil the
  // browser is still finishing that click, and settling focus afterwards would
  // collapse the selection to the end of the field.
  useEffect(() => {
    if (!renaming) return;
    cancelledRef.current = false;
    setDraft(item.title);
    const frame = requestAnimationFrame(() => {
      const el = nameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming, item.id]);

  // Clicking away saves; Escape throws the edit away. The flag keeps a blur
  // fired while the cancelled input unmounts from resurrecting the draft.
  function commitRename() {
    if (cancelledRef.current) return;
    onRenameCommit?.(draft);
  }

  function onNameKeyDown(e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    else if (e.key === "Escape") {
      e.preventDefault();
      cancelledRef.current = true;
      onRenameCancel?.();
    }
  }

  function clearPressVisual() {
    clearTimeout(t.current.pressVisualTimer);
    innerRef.current?.classList.remove("pressing");
  }

  // Thresholds derived from the row width captured at gesture start.
  function commitPx() { return (t.current.w || 0) * COMMIT_FRAC; }
  function longPx() { return Math.min((t.current.w || 0) * LONG_COMMIT_FRAC, LONG_COMMIT_MAX_PX); }

  function setBg(dx) {
    const el = bgRef.current;
    if (!el) return;
    const abs = Math.abs(dx);
    if (abs === 0) {
      el.style.opacity = 0;
      t.current.long = false;
      return;
    }
    const long = abs > longPx();
    el.dataset.dir = dx > 0 ? (long ? "tag" : "later") : (long ? "delete" : "archive");
    el.style.opacity = Math.min(1, abs / commitPx());
    // Light haptic when crossing into the long-swipe (secondary action) zone.
    if (long !== t.current.long) {
      if (long) { try { navigator.vibrate?.(8); } catch {} }
      t.current.long = long;
    }
  }

  function snapBack() {
    if (innerRef.current) {
      innerRef.current.style.transition = "transform .2s cubic-bezier(.2,.8,.2,1)";
      innerRef.current.style.transform = "translateX(0)";
    }
    if (bgRef.current) {
      bgRef.current.style.transition = "opacity .2s ease";
      bgRef.current.style.opacity = 0;
    }
  }

  function onTouchStart(e) {
    if (!isTouch() || renaming) return;
    // A tap that lands on one of the row's own controls belongs to that
    // control — don't let it start a swipe or count as a tap-to-open. The
    // suppression flag still resets, so a bailed-out gesture can't swallow the
    // next tap on the row.
    t.current.suppressClick = false;
    t.current.ignore = !!e.target.closest("button, input, .chip");
    if (t.current.ignore) return;
    const touch = e.touches[0];
    t.current.x0 = touch.clientX;
    t.current.y0 = touch.clientY;
    t.current.dx = 0;
    t.current.dy = 0;
    t.current.t0 = Date.now();
    t.current.swiping = false;
    t.current.suppressClick = false;
    t.current.long = false;
    t.current.w = innerRef.current?.offsetWidth || 0;
    if (innerRef.current) innerRef.current.style.transition = "none";
    if (bgRef.current) bgRef.current.style.transition = "none";
    clearTimeout(t.current.longPressTimer);
    clearTimeout(t.current.pressVisualTimer);
    t.current.pressVisualTimer = setTimeout(() => {
      if (!t.current.swiping) innerRef.current?.classList.add("pressing");
    }, PRESS_VISUAL_MS);
    t.current.longPressTimer = setTimeout(() => {
      if (!t.current.swiping && Math.abs(t.current.dx) < SWIPE_THRESH && Math.abs(t.current.dy) < SWIPE_THRESH) {
        t.current.suppressClick = true;
        try { navigator.vibrate?.(8); } catch {}
        clearPressVisual();
        onActions?.();
      }
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (!isTouch() || renaming || t.current.ignore) return;
    const touch = e.touches[0];
    const dx = touch.clientX - t.current.x0;
    const dy = touch.clientY - t.current.y0;
    t.current.dx = dx;
    t.current.dy = dy;

    if (!t.current.swiping) {
      if (Math.abs(dy) > SWIPE_THRESH && Math.abs(dy) > Math.abs(dx)) {
        clearTimeout(t.current.longPressTimer);
        clearPressVisual();
        return;
      }
      if (Math.abs(dx) > SWIPE_THRESH) {
        t.current.swiping = true;
        clearTimeout(t.current.longPressTimer);
        clearPressVisual();
      } else {
        return;
      }
    }

    if (innerRef.current) innerRef.current.style.transform = `translateX(${dx}px)`;
    setBg(dx);
  }

  function onTouchEnd() {
    if (!isTouch() || renaming || t.current.ignore) return;
    clearTimeout(t.current.longPressTimer);
    clearPressVisual();
    const { dx, dy, swiping, t0 } = t.current;

    if (swiping) {
      t.current.suppressClick = true;
      const abs = Math.abs(dx);
      if (abs > commitPx()) {
        const long = abs > longPx();
        if (dx > 0) onSwipe?.(long ? "tag" : "later");
        else onSwipe?.(long ? "delete" : "archived");
      }
      // Always snap back: when the commit cross-sections the row React
      // unmounts it (no visible animation), but when the move is a no-op
      // (e.g. swipe-right inside the Later view) the row stays mounted and
      // would otherwise keep the inline transform.
      snapBack();
      t.current.swiping = false;
      return;
    }

    if (Math.abs(dx) < SWIPE_THRESH && Math.abs(dy) < SWIPE_THRESH && Date.now() - t0 < 500) {
      t.current.suppressClick = true;
      onOpen();
    }
  }

  function onTouchCancel() {
    clearTimeout(t.current.longPressTimer);
    clearPressVisual();
    if (t.current.swiping) snapBack();
    t.current.swiping = false;
  }

  function handleClick(e) {
    if (t.current.suppressClick) {
      t.current.suppressClick = false;
      e.preventDefault();
      return;
    }
    onSelect();
  }

  // Roving tab stop: only the selected row and its own controls are reachable
  // with Tab. Making every row and every chip tabbable would mean well over a
  // thousand stops in a hoard this size, which is worse than not being
  // reachable at all.
  const rove = selected ? 0 : -1;

  // Without a name of its own the row would be announced as the concatenation
  // of everything inside it — including its buttons ("…Filter by hn, Rename
  // Ask HN…"). This says the useful part once.
  const stateWord = item.state === "later" ? "saved for later" : item.state === "archived" ? "archived" : "";
  const rowLabel = [item.title, domain(item.url), stateWord].filter(Boolean).join(", ");

  const tags = item.tags || [];
  const overflowTags = tagsOpen ? [] : tags.slice(COMPACT_TAGS);
  const shownTags = overflowTags.length ? tags.slice(0, COMPACT_TAGS) : tags;

  return (
    <div className="item-row" role="listitem">
      <div className="swipe-bg" ref={bgRef} aria-hidden="true">
        <span className="swipe-icon swipe-icon-later"><Clock size={16} /> Later</span>
        <span className="swipe-icon swipe-icon-tag"><Tag size={16} /> Tag</span>
        <span className="swipe-icon swipe-icon-delete">Delete <Trash2 size={16} /></span>
        <span className="swipe-icon swipe-icon-archive">Archive <Archive size={16} /></span>
      </div>
      <div
        ref={innerRef}
        className={"item" + (selected ? " sel" : "") + (renaming ? " renaming" : "")}
        tabIndex={renaming ? -1 : rove}
        aria-current={selected ? "true" : undefined}
        aria-label={renaming ? undefined : rowLabel}
        /* Tabbing to a row selects it, so keyboard focus and the app's own
           selection can never disagree. */
        onFocus={(e) => { if (e.target === e.currentTarget && !selected) onSelect(); }}
        onClick={handleClick}
        onDoubleClick={renaming ? undefined : onOpen}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {/* The letter-mark sits underneath and shows through when the favicon
            fails, instead of leaving the blank gap it used to. */}
        <div className="fav-well">
          <span className="fav-letter">{(domain(item.url)[0] || "?").toUpperCase()}</span>
          {item.favicon && (
            <img
              className="fav"
              src={item.favicon}
              alt=""
              onError={(e) => { e.currentTarget.remove(); }}
            />
          )}
        </div>
        <div className="meta">
          {renaming ? (
            <input
              ref={nameRef}
              className="title-input"
              value={draft}
              aria-label="Listing title"
              autoComplete="off"
              spellCheck="false"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onNameKeyDown}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="title" title={item.title}>{item.title}</div>
          )}
          <div className="url" title={item.url}>
            <span className="dom">{domain(item.url)}</span>
            <span className="sep">·</span>
            <span className="when">{ago(item.added)}</span>
            {selected && pathOf(item.url) && (
              <>
                <span className="sep">·</span>
                <span className="path">{pathOf(item.url)}</span>
              </>
            )}
          </div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className={"row-tags" + (tagsOpen ? " open" : "")}>
            {shownTags.map((t) => (
              <button
                key={t}
                type="button"
                className={"chip" + (t === tagFilter ? " active" : "")}
                tabIndex={rove}
                /* with a pointer, a tag long enough to ellipse can still be
                   read in full; on touch that's the tag editor's job */
                title={t}
                /* it toggles a filter rather than navigating, so pressed
                   state is the honest thing to announce */
                aria-pressed={t === tagFilter}
                aria-label={`Filter by ${t}`}
                onClick={(e) => { e.stopPropagation(); onFilterTag(t); }}
              >
                {t}
              </button>
            ))}
            {overflowTags.length > 0 && (
              <button
                type="button"
                className="chip chip-more"
                tabIndex={rove}
                /* The tooltip is the quick answer on a pointer device; the
                   click is the one that works everywhere. Both say the same
                   thing, so neither is the only way through. */
                title={overflowTags.map((t) => `#${t}`).join("  ")}
                aria-label={`Show ${overflowTags.length} more tag${overflowTags.length > 1 ? "s" : ""} on ${item.title}: ${overflowTags.join(", ")}`}
                onClick={(e) => { e.stopPropagation(); setTagsOpen(true); }}
              >
                +{overflowTags.length}
              </button>
            )}
          </div>
        )}

        {item.loading
          ? <span className="spin">reading…</span>
          : item.state === "later"
            ? <span className="badge later">Later</span>
            : item.state === "archived"
              ? <span className="badge archived">Archived</span>
              : null}

        {!renaming && (
          <button
            className="row-btn rename-btn"
            title="Rename (e)"
            aria-label={`Rename ${item.title}`}
            tabIndex={rove}
            onClick={(e) => { e.stopPropagation(); onSelect(); onRenameStart?.(); }}
          >
            <Pencil size={14} strokeWidth={2.2} />
          </button>
        )}

        <button
          className="row-btn refresh-btn"
          title="Refresh title & favicon (r)"
          aria-label={`Refresh title and favicon for ${item.title}`}
          tabIndex={rove}
          disabled={item.loading}
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        >
          <RotateCw size={14} strokeWidth={2.2} />
        </button>

        {/* The same sheet long-press opens — the tappable way in on touch
            devices, where there's no hover, no keyboard shortcuts and no
            details sidebar. */}
        {!renaming && (
          <button
            className="row-btn more-btn"
            title="Details & actions"
            aria-label={`Details and actions for ${item.title}`}
            aria-haspopup="dialog"
            tabIndex={rove}
            onClick={(e) => { e.stopPropagation(); onSelect(); onActions?.(); }}
          >
            <MoreHorizontal size={14} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  );
}
