// Calls the /api/meta serverless function. Returns { url, title, favicon }.
// Throws on failure so callers can keep their existing fallbacks.
export async function fetchMeta(url) {
  const res = await fetch("/api/meta?url=" + encodeURIComponent(url));
  if (!res.ok) throw new Error("meta lookup failed");
  return res.json();
}
