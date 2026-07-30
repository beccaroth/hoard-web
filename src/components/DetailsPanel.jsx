import {
  ExternalLink, Copy, Pencil, RotateCw, Trash2,
  Inbox, Clock, Archive, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import ItemFacts from "./ItemFacts.jsx";

const MOVES = [
  { key: "inbox", label: "Inbox", Icon: Inbox, hint: "" },
  { key: "later", label: "Later", Icon: Clock, hint: "s" },
  { key: "archived", label: "Archive", Icon: Archive, hint: "a" },
];

export default function DetailsPanel({
  item, open, tagFilter,
  onToggle, onOpen, onCopy, onRename, onRefresh, onTag, onFilterTag, onMove, onDelete,
}) {
  // Collapsed, the panel keeps a rail on the edge rather than vanishing —
  // otherwise there's nothing left to say it exists.
  if (!open) {
    return (
      <aside className="details collapsed">
        <button
          className="details-rail"
          title="Show details (i)"
          aria-label="Show details panel"
          aria-expanded="false"
          onClick={onToggle}
        >
          <PanelRightOpen size={15} />
          <span className="details-rail-label">Details</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="details" aria-label="Details">
      <div className="details-head">
        <span className="details-eyebrow">Details</span>
        <button
          className="details-toggle"
          title="Hide details (i)"
          aria-label="Hide details panel"
          aria-expanded="true"
          onClick={onToggle}
        >
          <PanelRightClose size={15} />
        </button>
      </div>

      {!item ? (
        <div className="details-empty">
          <span className="details-empty-line">Nothing selected.</span>
          <span className="details-empty-how">
            press <kbd>j</kbd><kbd>k</kbd> to move through the hoard
          </span>
        </div>
      ) : (
        <div className="details-body">
          <ItemFacts item={item} tagFilter={tagFilter} onFilterTag={onFilterTag} onTag={onTag} />

          <div className="details-actions">
            <button className="details-action" title="Open link (o)" onClick={onOpen}>
              <ExternalLink size={14} /> Open
            </button>
            <button className="details-action" title="Copy URL (c)" onClick={onCopy}>
              <Copy size={14} /> Copy
            </button>
            <button className="details-action" title="Rename (e)" onClick={onRename}>
              <Pencil size={14} /> Rename
            </button>
            <button
              className="details-action"
              title="Refresh title & favicon (r)"
              disabled={item.loading}
              onClick={onRefresh}
            >
              <RotateCw size={14} /> {item.loading ? "Reading…" : "Refresh"}
            </button>
          </div>

          <div className="details-moves">
            {MOVES.filter((m) => m.key !== item.state).map((m) => (
              <button
                key={m.key}
                className="details-action"
                title={m.hint ? `Move to ${m.label} (${m.hint})` : `Move to ${m.label}`}
                onClick={() => onMove(m.key)}
              >
                <m.Icon size={14} /> {m.label}
              </button>
            ))}
          </div>

          <button className="details-action details-danger" title="Delete (d)" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
