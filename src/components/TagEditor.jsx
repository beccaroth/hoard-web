import { useEffect, useRef, useState } from "react";

// Docked tag editor for a single item, with autocomplete over existing tags.
export default function TagEditor({ item, allTags, onAdd, onRemove, onClose }) {
  const [val, setVal] = useState("");
  const [hi, setHi] = useState(-1);
  const inputRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [item.id]);

  // The bar is docked to the bottom of the window, which on a phone or tablet
  // is exactly where the software keyboard appears — and a fixed element stays
  // put underneath it. Track how much of the viewport the keyboard is covering
  // and lift the bar by that much.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      barRef.current?.style.setProperty("--kb-inset", `${covered}px`);
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

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
      // This Escape was for the tag bar, and it ends here. Left to bubble it
      // reaches the window handler with the input already gone, so nothing
      // recognises it as spent: it used to fall through and clear an active tag
      // filter, and with triage open it would shut the whole sitting down.
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="tagbar show" ref={barRef}>
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
