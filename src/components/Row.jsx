import { useRef } from "react";
import { RotateCw, Clock, Archive } from "lucide-react";

const COMMIT_PX = 80;
const SWIPE_THRESH = 10;
const LONG_PRESS_MS = 500;
const PRESS_VISUAL_MS = 200;

function isMobile() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

export default function Row({ item, selected, tagFilter, onSelect, onOpen, onFilterTag, onRefresh, onSwipe, onLongPress }) {
  const innerRef = useRef(null);
  const bgRef = useRef(null);
  const t = useRef({
    x0: 0, y0: 0, dx: 0, dy: 0, t0: 0,
    swiping: false, longPressTimer: null, pressVisualTimer: null, suppressClick: false,
  });

  function clearPressVisual() {
    clearTimeout(t.current.pressVisualTimer);
    innerRef.current?.classList.remove("pressing");
  }

  function setBg(dx) {
    const el = bgRef.current;
    if (!el) return;
    if (dx > 0) {
      el.dataset.dir = "later";
      el.style.opacity = Math.min(1, Math.abs(dx) / COMMIT_PX);
    } else if (dx < 0) {
      el.dataset.dir = "archive";
      el.style.opacity = Math.min(1, Math.abs(dx) / COMMIT_PX);
    } else {
      el.style.opacity = 0;
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
    if (!isMobile()) return;
    const touch = e.touches[0];
    t.current.x0 = touch.clientX;
    t.current.y0 = touch.clientY;
    t.current.dx = 0;
    t.current.dy = 0;
    t.current.t0 = Date.now();
    t.current.swiping = false;
    t.current.suppressClick = false;
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
        onLongPress?.();
      }
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (!isMobile()) return;
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
    if (!isMobile()) return;
    clearTimeout(t.current.longPressTimer);
    clearPressVisual();
    const { dx, dy, swiping, t0 } = t.current;

    if (swiping) {
      t.current.suppressClick = true;
      if (Math.abs(dx) > COMMIT_PX) {
        if (dx > 0) onSwipe?.("later");
        else onSwipe?.("archived");
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

  return (
    <div className="item-row">
      <div className="swipe-bg" ref={bgRef} aria-hidden="true">
        <span className="swipe-icon swipe-icon-later"><Clock size={16} /> Later</span>
        <span className="swipe-icon swipe-icon-archive">Archive <Archive size={16} /></span>
      </div>
      <div
        ref={innerRef}
        className={"item" + (selected ? " sel" : "")}
        onClick={handleClick}
        onDoubleClick={onOpen}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <img
          className="fav"
          src={item.favicon}
          alt=""
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
        <div className="meta">
          <div className="title">{item.title}</div>
          <div className="url">{item.url}</div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className="row-tags">
            {item.tags.map((t) => (
              <span
                key={t}
                className={"chip" + (t === tagFilter ? " active" : "")}
                onClick={(e) => { e.stopPropagation(); onFilterTag(t); }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {item.loading
          ? <span className="spin">reading…</span>
          : item.state === "later"
            ? <span className="badge later">later</span>
            : item.state === "archived"
              ? <span className="badge archived">archived</span>
              : null}

        <button
          className="refresh-btn"
          title="Refresh title & favicon (r)"
          disabled={item.loading}
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        >
          <RotateCw size={14} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
