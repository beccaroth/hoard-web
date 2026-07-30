# Hoard

A keyboard-first URL hoarder. Paste links, file them to Inbox / Saved for Later / Archived, tag and search, and run it all without leaving the keyboard. Optional cross-device sync via Supabase.

## Run locally

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Set `PORT` to run somewhere
else — handy when another worktree already has 5173.

## Build

```sh
npm run build
npm run preview
```

## Sync (optional)

Cross-device sync is no-op unless Supabase env vars are configured. See [src/lib/sync.js](src/lib/sync.js) for the expected variables.

## Shortcuts

Press the keyboard icon in the header (or `⌘K` for the command palette) to see the full list. Highlights:

| Key | Action |
| --- | --- |
| `j` / `k` | Move selection |
| `o` | Open in new tab |
| `c` | Copy URL |
| `t` | Edit tags |
| `s` / `a` / `d` | Save for later / archive / delete |
| `1`–`4` | Switch views |
| `[` | Toggle sidebar |
| `/` | Focus search |
| `u` | Undo |

## Quick add from anywhere

Hoard files any link opened with `?add=<url>` (optionally `&title=<title>`). The
add happens after sync settles, then the params are stripped from the URL.

**Desktop bookmarklet** — make a new bookmark with this as the URL, then click it
on any page:

```js
javascript:(function(){window.open('https://hoard.rebeccaroth.dev/?add='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank');})();
```

**iPhone (Share Sheet shortcut)** — in the Shortcuts app, create a shortcut that:

1. Toggle on **Show in Share Sheet** and accept **URLs**.
2. Add an **Open URLs** action with:
   `https://hoard.rebeccaroth.dev/?add=[Shortcut Input]`

Then share any page → your shortcut → it opens Hoard and files the link.

## Stack

React + Vite, Zustand for state, Sonner for toasts, Lucide icons. Mobile-responsive with a bottom-sheet deposit panel.
