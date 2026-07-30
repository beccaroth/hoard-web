# Features

## Notes
A free-text note per link — why it was worth keeping, which is the thing a
title and a description never say.

Open questions worth settling before building:

- **Where it's written.** The details panel is the obvious home. Triage is the
  moment you actually have the reason in your head, though, so a note field on
  the card may be worth more than one buried in the sidebar.
- **Whether search reads it.** It should — a note is often the only place the
  words you'd search for exist. `matchesItem` already searches title, URL and
  tags, so it's one more field in the haystack.
- **It rides the sync blob.** Notes are unbounded in a way tags and titles
  aren't, and the whole hoard is pushed as one payload. Worth a cap, or at
  least knowing what a long one costs.
- **Merge.** Two devices editing the same note is the first real conflict this
  data model would have — everything else is last-write-wins on a short field.
  Losing a paragraph that way is worse than losing a tag.

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
