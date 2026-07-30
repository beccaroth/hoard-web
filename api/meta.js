// Vercel serverless function: GET /api/meta?url=<encoded>
// Returns { url, title, favicon, description, image } using oEmbed → scrape →
// Microlink → slug, the same strategy as the standalone Node server. Runs on
// Node (global fetch).

// Descriptions ride along in the synced blob, so they're capped rather than
// stored at whatever length a page felt like emitting. Long enough to say what
// a page is; short enough that a few thousand of them stay cheap.
const DESC_MAX = 300;

// Meta tags come in both attribute orders in the wild — `property` before
// `content` and the other way round — so match either rather than assuming.
function metaContent(html, attr, value) {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${v}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${v}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function cleanText(raw, max) {
  if (!raw) return "";
  const s = decodeEntities(raw)
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  // Trim at a word boundary so the tail doesn't end mid-word.
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function absolute(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const JUNK_TITLE =
  /please wait|robot check|are you a robot|just a moment|access denied|attention required|verifying|verification|forbidden|enable javascript|something went wrong|page not found|\b404\b/i;

function titleFromUrl(target) {
  try {
    const u = new URL(target);
    const parts = u.pathname.split("/").filter(Boolean);
    let slug = "";
    const ci = parts.indexOf("comments");
    const dpi = parts.findIndex(p => p === "dp" || p === "gp" || p === "product");
    if (ci >= 0 && parts[ci + 2]) slug = parts[ci + 2];
    else if (dpi >= 1) slug = parts[dpi - 1];
    else slug = parts[parts.length - 1] || "";
    if (!slug) return null;
    slug = decodeURIComponent(slug).replace(/\.[a-z0-9]{1,5}$/i, "");
    slug = slug.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
    if (!slug || slug.length < 3 || /^[0-9a-f]{6,}$/i.test(slug) || /^\d+$/.test(slug)) return null;
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  } catch { return null; }
}

async function oEmbedTitle(target, signal) {
  try {
    const u = new URL(target);
    let endpoint = null;
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) {
      endpoint = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(target);
    } else if (/(^|\.)vimeo\.com$/i.test(u.hostname)) {
      endpoint = "https://vimeo.com/api/oembed.json?url=" + encodeURIComponent(target);
    }
    if (!endpoint) return null;
    const res = await fetch(endpoint, { signal, headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.title ? String(data.title).trim() : null;
  } catch { return null; }
}

async function microlinkMeta(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { "Accept": "application/json" };
    if (process.env.MICROLINK_KEY) headers["x-api-key"] = process.env.MICROLINK_KEY;
    const res = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(target), {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success" || !json.data) return null;
    const d = json.data;
    return {
      title: d.title ? String(d.title).trim() : null,
      favicon: (d.logo && d.logo.url) || (d.favicon && d.favicon.url) || null,
      description: cleanText(d.description ? String(d.description) : "", DESC_MAX),
      image: (d.image && d.image.url) || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMeta(target) {
  const u = new URL(target);
  const domainTitle = u.hostname.replace(/^www\./, "");
  const result = {
    url: target,
    title: domainTitle,
    favicon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
    // Always present, even when the page offers nothing — an empty string is
    // how the client tells "looked, found none" apart from "never looked",
    // which is what stops it re-fetching the same barren page forever.
    description: "",
    image: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const oe = await oEmbedTitle(target, controller.signal);
    if (oe) result.title = oe;

    const res = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const finalUrl = res.url || target;
    const ctype = res.headers.get("content-type") || "";

    if (ctype.includes("html")) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let html = "";
      let bytes = 0;
      while (bytes < 512 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      try { await reader.cancel(); } catch {}

      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const rawTitle = (ogTitle && ogTitle[1]) || (titleTag && titleTag[1]);
      const scraped = rawTitle
        ? decodeEntities(rawTitle)
            .replace(/[​-‏‪-‮﻿]/g, "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
      if (scraped && !JUNK_TITLE.test(scraped) && result.title === domainTitle) {
        result.title = scraped;
      }

      // og:description is written for exactly this — a one-line answer to "what
      // is this page" — and the plain description tag is the fallback.
      result.description = cleanText(
        metaContent(html, "property", "og:description")
          || metaContent(html, "name", "og:description")
          || metaContent(html, "name", "description")
          || metaContent(html, "name", "twitter:description"),
        DESC_MAX,
      );

      const rawImage =
        metaContent(html, "property", "og:image")
        || metaContent(html, "name", "og:image")
        || metaContent(html, "name", "twitter:image")
        || metaContent(html, "name", "twitter:image:src");
      if (rawImage) {
        const abs = absolute(decodeEntities(rawImage), finalUrl);
        // Only the URL is kept — the image itself stays on its own host, so a
        // preview costs the blob a couple of hundred bytes rather than a file.
        if (abs && /^https?:/i.test(abs)) result.image = abs;
      }

      const iconMatch = [...html.matchAll(/<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi)]
        .map(m => m[0])
        .map(tag => {
          const href = tag.match(/href=["']([^"']+)["']/i);
          const sizes = tag.match(/sizes=["']([^"']+)["']/i);
          return href ? { href: href[1], size: sizes ? parseInt(sizes[1]) || 0 : 0 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.size - a.size)[0];
      if (iconMatch) {
        const abs = absolute(decodeEntities(iconMatch.href), finalUrl);
        if (abs) result.favicon = abs;
      }
    }
  } catch {
    // network/timeout — keep fallbacks
  } finally {
    clearTimeout(timer);
  }

  if (result.title === domainTitle || JUNK_TITLE.test(result.title)) {
    const ml = await microlinkMeta(target);
    if (ml && ml.title && !JUNK_TITLE.test(ml.title)) {
      result.title = ml.title;
      if (ml.favicon) result.favicon = ml.favicon;
    }
  }

  if (result.title === domainTitle || JUNK_TITLE.test(result.title)) {
    const fromUrl = titleFromUrl(target);
    if (fromUrl) result.title = fromUrl;
  }
  return result;
}

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).json({ error: "bad url" });
    return;
  }
  try {
    const meta = await fetchMeta(target);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    res.status(200).json(meta);
  } catch {
    res.status(500).json({ error: "fetch failed" });
  }
}
