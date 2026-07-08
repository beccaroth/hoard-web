// cyrb53: small, fast, well-distributed string hash (53-bit). Non-cryptographic
// — we only need a stable, collision-resistant fingerprint of a URL.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Stable item id derived from the normalized URL, so the same link created
// independently on two devices converges to one item on merge (instead of two
// random ids that both survive). The `u_` prefix keeps derived ids in their own
// namespace — it can never equal a legacy random id (8 chars of [0-9a-z]).
export function urlId(url) {
  return "u_" + cyrb53(normalizeUrl(url)).toString(36);
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
