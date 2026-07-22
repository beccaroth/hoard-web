import { useEffect, useMemo, useRef, useState } from "react";
import { extractUrls, normalizeUrl } from "../lib/urls.js";

// Dragging this to the bookmarks bar is the fastest way to stash, and until
// now nothing in the app mentioned it existed.
const BOOKMARKLET =
  "javascript:(function(){window.open('" +
  (typeof window !== "undefined" ? window.location.origin : "") +
  "/?add='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank');})()";

export default function StashModal({ existingUrls, onStash, onClose }) {
  const [text, setText] = useState("");
  const taRef = useRef(null);
  const bookmarkletRef = useRef(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  // The href is set imperatively: React warns on `javascript:` hrefs passed
  // through JSX and intends to block them outright, which would quietly break
  // the drag. Setting the attribute directly keeps the link draggable.
  useEffect(() => { bookmarkletRef.current?.setAttribute("href", BOOKMARKLET); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); onClose(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Count what's actually about to happen, using the same extractor and
  // dedupe key the store will use — so the number can't disagree with the
  // result. The old panel filed silently and skipped duplicates invisibly.
  const { found, dupes, fresh } = useMemo(() => {
    const urls = extractUrls(text);
    const seen = new Set(existingUrls);
    let dupes = 0;
    const keys = new Set();
    urls.forEach((u) => {
      const key = normalizeUrl(u);
      if (seen.has(key) || keys.has(key)) dupes++;
      else keys.add(key);
    });
    return { found: urls.length, dupes, fresh: keys.size };
  }, [text, existingUrls]);

  function commit() {
    if (!fresh) return;
    onStash(text);
    onClose();
  }

  function onKeyDown(e) {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); }
  }

  return (
    <div className="stash-backdrop" onClick={onClose}>
      <div
        className="stash-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Stash links"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stash-head">
          Stash links
          <button className="stash-close" aria-label="Close" onClick={onClose}>ESC</button>
        </div>
        <div className="stash-note">
          One per line, or paste any text and I'll pull the links out of it.
        </div>
        <textarea
          ref={taRef}
          value={text}
          spellCheck="false"
          aria-label="Links to stash"
          placeholder={"https://example.com\nhttps://news.ycombinator.com\na paragraph with a link.tld inside it…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="stash-foot">
          <span className="stash-count">
            {found === 0
              ? "Nothing found yet"
              : <>{found} found{dupes > 0 && <> · <b>{dupes} already stashed</b></>}</>}
          </span>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!fresh} onClick={commit}>
            {fresh > 1 ? `Stash ${fresh} links` : fresh === 1 ? "Stash 1 link" : "Stash"}
          </button>
        </div>

        {/* Collapsed by default — it's a one-time thing to learn, not something
            to read every time you paste a link. */}
        <details className="stash-faster">
          <summary className="lab">Faster ways to stash</summary>
          <div className="row-way">
            <a
              ref={bookmarkletRef}
              className="bookmarklet"
              onClick={(e) => e.preventDefault()}
              title="Drag me to your bookmarks bar"
            >
              ＋ Stash
            </a>
            <span>drag to your bookmarks bar</span>
          </div>
          <div className="row-way">
            <b>iOS Shortcut</b>
            <span>— stash from the share sheet on iPhone &amp; iPad</span>
          </div>
        </details>
      </div>
    </div>
  );
}
