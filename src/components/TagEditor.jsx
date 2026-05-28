import { useEffect, useRef, useState } from "react";

// Docked tag editor for a single item, with autocomplete over existing tags.
export default function TagEditor({ item, allTags, onAdd, onRemove, onClose }) {
  const [val, setVal] = useState("");
  const [hi, setHi] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [item.id]);

  const have = new Set(item.tags || []);
  const q = val.trim().replace(/^#/, "").toLowerCase();
  const sugg = allTags
    .filter((t) => !have.has(t) && (q === "" || t.includes(q)))
    .sort((a, b) => (b.startsWith(q) ? 1 : 0) - (a.startsWith(q) ? 1 : 0))
    .slice(0, 8);

  function commit(tag) {
    onAdd(item.id, tag);
    setVal("");
    setHi(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (sugg.length) setHi((h) => (h + 1) % sugg.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (sugg.length) setHi((h) => (h <= 0 ? sugg.length - 1 : h - 1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (hi >= 0 && sugg[hi]) { e.preventDefault(); commit(sugg[hi]); }
      else if (e.key === "Enter" && val.trim()) { e.preventDefault(); commit(val); }
    } else if (e.key === ",") {
      e.preventDefault();
      if (val.trim()) commit(val);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="tagbar show">
      <span className="tb-label">Tag</span>
      <span className="tb-title">{item.title}</span>
      {item.tags && item.tags.length > 0 && (
        <div className="tb-chips">
          {item.tags.map((t) => (
            <span key={t} className="ebchip">
              {t}
              <button title="remove" onClick={() => onRemove(item.id, t)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="tb-input-wrap">
        <input
          ref={inputRef}
          value={val}
          placeholder="add tag…"
          autoComplete="off"
          spellCheck="false"
          onChange={(e) => { setVal(e.target.value); setHi(-1); }}
          onKeyDown={onKeyDown}
        />
        <div className={"tb-suggest" + (sugg.length ? " show" : "")}>
          {sugg.map((t, i) => (
            <button
              key={t}
              className={"sg" + (i === hi ? " active" : "")}
              onMouseDown={(e) => { e.preventDefault(); commit(t); }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <button className="tb-done" onClick={onClose}>Done</button>
    </div>
  );
}
