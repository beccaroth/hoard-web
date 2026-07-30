import { useState } from "react";
import {
  ExternalLink, Copy, Pencil, RotateCw, Tag, Trash2,
  Inbox, Clock, Archive, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { domain } from "../lib/urls.js";
import { ago, stamp } from "../lib/time.js";

const MOVES = [
  { key: "inbox", label: "Inbox", Icon: Inbox, hint: "" },
  { key: "later", label: "Later", Icon: Clock, hint: "s" },
  { key: "archived", label: "Archive", Icon: Archive, hint: "a" },
];

const STATE_WORD = { inbox: "Inbox", later: "Saved for later", archived: "Archived" };

export default function DetailsPanel({
  item, open, tagFilter,
  onToggle, onOpen, onCopy, onRename, onRefresh, onTag, onFilterTag, onMove, onDelete,
}) {
  // The favicon URL that 404'd, if any — see the img below.
  const [failedFav, setFailedFav] = useState(null);

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
          <div className="details-site">
            <div className="fav-well details-fav">
              <span className="fav-letter">{(domain(item.url)[0] || "?").toUpperCase()}</span>
              {item.favicon && failedFav !== item.favicon && (
                <img
                  className="fav"
                  src={item.favicon}
                  alt=""
                  /* A row can rip its own broken favicon out of the DOM because
                     the whole row unmounts as one node. This well outlives the
                     selection, so React reconciles the img itself — pulling it
                     out from under React throws on the next selection change
                     and takes the app down. Remember the dead URL instead; the
                     letter-mark underneath shows through, and a different item
                     (or a refreshed favicon) gets a fair try. */
                  onError={() => setFailedFav(item.favicon)}
                />
              )}
            </div>
            <div className="details-site-meta">
              <h2 className="details-title">{item.title}</h2>
              <span className="details-domain">{domain(item.url)}</span>
            </div>
          </div>

          <a className="details-url" href={item.url} target="_blank" rel="noreferrer">
            <span className="details-url-text">{item.url}</span>
            <ExternalLink size={12} />
          </a>

          <dl className="details-facts">
            <div className="details-fact">
              <dt>Status</dt>
              <dd className={"details-state " + item.state}>{STATE_WORD[item.state] || item.state}</dd>
            </div>
            <div className="details-fact">
              <dt>Added</dt>
              <dd>
                {stamp(item.added)}
                <span className="details-ago">{ago(item.added)}</span>
              </dd>
            </div>
            {item.updatedAt && item.updatedAt !== item.added && (
              <div className="details-fact">
                <dt>Changed</dt>
                <dd>
                  {stamp(item.updatedAt)}
                  <span className="details-ago">{ago(item.updatedAt)}</span>
                </dd>
              </div>
            )}
          </dl>

          <div className="details-block">
            <div className="details-block-head">
              <span className="details-eyebrow">Tags</span>
              <button className="details-link-btn" title="Edit tags (t)" onClick={onTag}>
                <Tag size={12} /> Edit
              </button>
            </div>
            {item.tags && item.tags.length > 0 ? (
              <div className="details-tags">
                {item.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={"chip" + (t === tagFilter ? " active" : "")}
                    aria-pressed={t === tagFilter}
                    aria-label={`Filter by ${t}`}
                    onClick={() => onFilterTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : (
              <span className="details-none">none yet</span>
            )}
          </div>

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
