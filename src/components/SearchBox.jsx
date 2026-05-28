import { forwardRef, useState } from "react";
import { Search } from "lucide-react";

// Search input with `#tag` autocomplete. The current (last) token drives
// suggestions: when it starts with `#`, matching tags are offered.
const SearchBox = forwardRef(function SearchBox({ query, setQuery, allTags }, ref) {
  const [hi, setHi] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  // The active tag segment is everything after the last "#" (tags may contain
  // spaces, so we can't key off whitespace tokens).
  const hashIdx = query.lastIndexOf("#");
  const prefix = hashIdx >= 0 ? query.slice(hashIdx + 1).toLowerCase() : "";
  const sugg = hashIdx >= 0 && !dismissed
    ? allTags
        .filter((t) => t.toLowerCase().includes(prefix))
        .sort((a, b) => (b.toLowerCase().startsWith(prefix) ? 1 : 0) - (a.toLowerCase().startsWith(prefix) ? 1 : 0))
        .slice(0, 8)
    : [];
  const open = sugg.length > 0;

  function change(v) { setQuery(v); setHi(-1); setDismissed(false); }

  function accept(tag) {
    setQuery(query.slice(0, hashIdx) + "#" + tag + " ");
    setHi(-1);
    setDismissed(true);
  }

  function onKeyDown(e) {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % sugg.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h <= 0 ? sugg.length - 1 : h - 1)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(sugg[hi >= 0 ? hi : 0]); return; }
      if (e.key === "Escape") { e.preventDefault(); setDismissed(true); return; }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery(""); else e.currentTarget.blur();
    }
  }

  return (
    <div className="search-wrap">
      <Search className="search-icon" size={14} />
      <input
        ref={ref}
        className="search"
        type="text"
        placeholder="Search…  #tag"
        value={query}
        autoComplete="off"
        spellCheck="false"
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="search-suggest show">
          {sugg.map((t, i) => (
            <button
              key={t}
              className={"sg" + (i === hi ? " active" : "")}
              onMouseDown={(e) => { e.preventDefault(); accept(t); }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default SearchBox;
