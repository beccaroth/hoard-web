import { RotateCw } from "lucide-react";

export default function Row({ item, selected, tagFilter, onSelect, onOpen, onFilterTag, onRefresh }) {
  return (
    <div
      className={"item" + (selected ? " sel" : "")}
      onClick={onSelect}
      onDoubleClick={onOpen}
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
  );
}
