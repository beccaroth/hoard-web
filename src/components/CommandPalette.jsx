import { useEffect, useRef, useState } from "react";

// ⌘K palette: fuzzy-find a link or run a command. Keyboard-driven.
export default function CommandPalette({ items, commands, onRunItem, onClose }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const ql = q.trim().toLowerCase();
  const cmds = commands.filter((c) => !ql || c.label.toLowerCase().includes(ql));
  const links = (ql
    ? items.filter((i) => (i.title + " " + i.url + " " + (i.tags || []).join(" ")).toLowerCase().includes(ql))
    : items
  ).slice(0, 8);

  const results = [
    ...cmds.map((c) => ({ type: "cmd", key: "c" + c.id, c })),
    ...links.map((i) => ({ type: "item", key: "i" + i.id, i })),
  ];

  useEffect(() => { setIdx(0); }, [ql]);
  useEffect(() => {
    listRef.current?.querySelector(".cmdk-item.active")?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  function run(r) {
    if (!r) return;
    if (r.type === "cmd") r.c.run();
    else onRunItem(r.i);
    onClose();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(results[idx]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  let n = -1; // running index across both groups, matching `results`
  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search links or run a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 && <div className="cmdk-empty">No matches</div>}
          {cmds.length > 0 && <div className="cmdk-group">Commands</div>}
          {cmds.map((c) => {
            n += 1;
            const active = n === idx;
            const myIdx = n;
            return (
              <button key={"c" + c.id} className={"cmdk-item" + (active ? " active" : "")}
                onMouseEnter={() => setIdx(myIdx)} onClick={() => run({ type: "cmd", c })}>
                {c.icon && <span className="cmdk-ic">{c.icon}</span>}
                <span className="cmdk-cmd-label">{c.label}</span>
                {c.hint && <kbd>{c.hint}</kbd>}
              </button>
            );
          })}
          {links.length > 0 && <div className="cmdk-group">Links</div>}
          {links.map((i) => {
            n += 1;
            const active = n === idx;
            const myIdx = n;
            return (
              <button key={"i" + i.id} className={"cmdk-item" + (active ? " active" : "")}
                onMouseEnter={() => setIdx(myIdx)} onClick={() => run({ type: "item", i })}>
                <img className="cmdk-fav" src={i.favicon} alt=""
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                <span className="cmdk-title">{i.title}</span>
                <span className="cmdk-url">{i.url}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
