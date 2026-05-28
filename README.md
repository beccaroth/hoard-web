# Hoard

A keyboard-first URL hoarder. Paste links, file them to Inbox / Saved for Later / Archived, tag and search, and run it all without leaving the keyboard. Optional cross-device sync via Supabase.

## Run locally

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

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

## Stack

React + Vite, Zustand for state, Sonner for toasts, Lucide icons. Mobile-responsive with a bottom-sheet deposit panel.
