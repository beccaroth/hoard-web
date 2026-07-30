import { useEffect } from "react";
import { ExternalLink, Copy, Pencil, Tag, RotateCw, Inbox, Clock, Archive, Trash2, X } from "lucide-react";
import ItemFacts from "./ItemFacts.jsx";

const MOVE_OPTIONS = [
  { key: "inbox", label: "Move to Inbox", Icon: Inbox },
  { key: "later", label: "Save for Later", Icon: Clock },
  { key: "archived", label: "Archive", Icon: Archive },
];

// The phone's details panel. The sidebar is hidden under 900px and there's no
// room to bring it back, so the sheet the row already opened for its actions
// carries the facts too — status, both timestamps, the whole URL, every tag —
// rather than leaving them unreachable on the device most of the triaging
// happens on.
export default function RowActions({
  item, tagFilter,
  onClose, onOpen, onCopy, onRename, onTag, onRefresh, onFilterTag, onMove, onDelete,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="row-actions-backdrop" onClick={onClose}>
      <div
        className="row-actions-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Details for ${item.title}`}
      >
        <div className="row-actions-head">
          <span className="details-eyebrow">Details</span>
          <button className="row-actions-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Facts and actions scroll together: a long title, a full URL and a
            dozen tags can outgrow the sheet, and pinning the list while the
            facts scroll would cost the actions half the screen on a phone. */}
        <div className="row-actions-scroll">
          <div className="sheet-facts">
            <ItemFacts
              item={item}
              tagFilter={tagFilter}
              onFilterTag={onFilterTag}
              onTag={onTag}
            />
          </div>

          <div className="row-actions-list">
            <button className="row-action" onClick={onOpen}>
              <ExternalLink size={16} /> Open link
            </button>
            {/* No `c` shortcut without a keyboard, so copying lived only on the
                desktop panel until now. */}
            <button className="row-action" onClick={onCopy}>
              <Copy size={16} /> Copy URL
            </button>
            <button className="row-action" onClick={onRename}>
              <Pencil size={16} /> Rename
            </button>
            <button className="row-action" onClick={onTag}>
              <Tag size={16} /> Edit tags
            </button>
            <button className="row-action" onClick={onRefresh} disabled={item.loading}>
              <RotateCw size={16} /> {item.loading ? "Reading…" : "Refresh metadata"}
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
    </div>
  );
}
