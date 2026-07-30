// "2h ago" beats a raw timestamp in a row you're skimming — but the details
// panel has the room to say both, so the two live together here.

export function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 365)}y ago`;
}

// The exact moment, in the reader's locale — used where "3w ago" isn't enough.
export function stamp(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
