import { useState } from "react";
import { ExternalLink, Tag } from "lucide-react";
import { domain } from "../lib/urls.js";
import { ago, stamp } from "../lib/time.js";

const STATE_WORD = { inbox: "Inbox", later: "Saved for later", archived: "Archived" };

// Everything a row hasn't the width to show: the whole URL, both timestamps,
// the full tag set. Shared by the desktop sidebar and the mobile sheet, so the
// two can't drift into telling different stories about the same item.
export default function ItemFacts({ item, tagFilter, onFilterTag, onTag }) {
  // The favicon URL that 404'd, if any — see the img below.
  const [failedFav, setFailedFav] = useState(null);
  // Same trick for the preview: og:image points at someone else's host, and a
  // dead link there should leave no trace rather than a broken-image box.
  const [failedImg, setFailedImg] = useState(null);

  return (
    <>
      <div className="details-site">
        <div className="fav-well details-fav">
          <span className="fav-letter">{(domain(item.url)[0] || "?").toUpperCase()}</span>
          {item.favicon && failedFav !== item.favicon && (
            <img
              className="fav"
              src={item.favicon}
              alt=""
              /* A row can rip its own broken favicon out of the DOM because the
                 whole row unmounts as one node. This well outlives the
                 selection, so React reconciles the img itself — pulling it out
                 from under React throws on the next selection change and takes
                 the app down. Remember the dead URL instead; the letter-mark
                 underneath shows through, and a different item (or a refreshed
                 favicon) gets a fair try. */
              onError={() => setFailedFav(item.favicon)}
            />
          )}
        </div>
        <div className="details-site-meta">
          <h2 className="details-title">{item.title}</h2>
          <span className="details-domain">{domain(item.url)}</span>
        </div>
      </div>

      {item.image && failedImg !== item.image && (
        <img
          className="details-image"
          src={item.image}
          alt=""
          loading="lazy"
          /* Someone else's host, and a referrer that leaks which links you keep
             is not a thing to hand over for a thumbnail. */
          referrerPolicy="no-referrer"
          onError={() => setFailedImg(item.image)}
        />
      )}

      {item.description && <p className="details-description">{item.description}</p>}

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
    </>
  );
}
