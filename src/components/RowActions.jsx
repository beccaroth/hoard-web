import { useEffect } from "react";
import { ExternalLink, Tag, RotateCw, Inbox, Clock, Archive, Trash2, X } from "lucide-react";

const MOVE_OPTIONS = [
  { key: "inbox", label: "Move to Inbox", Icon: Inbox },
  { key: "later", label: "Save for Later", Icon: Clock },
  { key: "archived", label: "Archive", Icon: Archive },
];

export default function RowActions({ item, onClose, onOpen, onTag, onRefresh, onMove, onDelete }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="row-actions-backdrop" onClick={onClose}>
      <div className="row-actions-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Row actions">
        <div className="row-actions-head">
          <div className="row-actions-title">
            <img
              className="row-actions-fav"
              src={item.favicon}
              alt=""
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            />
            <div className="row-actions-meta">
              <div className="row-actions-name">{item.title}</div>
              <div className="row-actions-url">{item.url}</div>
            </div>
          </div>
          <button className="row-actions-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="row-actions-list">
          <button className="row-action" onClick={onOpen}>
            <ExternalLink size={16} /> Open link
          </button>
          <button className="row-action" onClick={onTag}>
            <Tag size={16} /> Edit tags
          </button>
          <button className="row-action" onClick={onRefresh} disabled={item.loading}>
            <RotateCw size={16} /> Refresh metadata
          </button>
          <div className="row-actions-sep" />
          {MOVE_OPTIONS.filter((o) => o.key !== item.state).map((o) => (
            <button key={o.key} className="row-action" onClick={() => onMove(o.key)}>
              <o.Icon size={16} /> {o.label}
            </button>
          ))}
          <div className="row-actions-sep" />
          <button className="row-action row-action-danger" onClick={onDelete}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
