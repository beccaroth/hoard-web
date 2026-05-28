export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function extractUrls(text) {
  const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
  const found = text.match(re) || [];
  text.split(/\s+/).forEach((tok) => {
    if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(tok) && !/^https?:/i.test(tok)) {
      found.push("https://" + tok);
    }
  });
  return [...new Set(found.map((u) => u.replace(/[.,);]+$/, "")))];
}

export function domain(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function googleFav(u) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(u).hostname}&sz=64`;
  } catch {
    return "";
  }
}

// Drop protocol/www differences, trailing slashes, the hash, and common
// tracking params so near-identical links collapse to one dedupe key.
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|mc_eid$|ref$|ref_|igshid$|si$|spm$|_hsenc$|_hsmi$|yclid$)/i;
export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    });
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const qs = [...u.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join("&");
    return host + path + (qs ? "?" + qs : "");
  } catch {
    return String(raw).toLowerCase();
  }
}
