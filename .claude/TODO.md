# Features

## AI Summary
Some API for link summaries?

Narrower than it was: the triage card and the details panel now show the page's
own `og:description`, which covers the common case. What's left for a real
summary is the pages that don't have one, and anything long enough that a
sentence lifted from the head doesn't do it justice.

## Desktop App
Electron or Rust

# Shipped

## Detail view on mobile — #13
The sidebar is hidden under 900px, so status, timestamps, the full URL and the
tag set were unreachable on a phone. The row's actions sheet carries them now.

## Triage View — #15
One card, the whole inbox behind it: Archive, Save for Later, Skip for Now,
with Tag and Edit on the card. Walks `state === "inbox"` only. Skipping is
session-only — Saved for Later is already the durable "not now".

## Description & preview on the card — #16
`og:description` and `og:image`, scraped in the same pass that already reads
`og:title`, filling the space the triage sketch left open. Not an iframe: HN
and GitHub send `X-Frame-Options: DENY`, docs sites mostly don't, and the page
can't tell which it got.
