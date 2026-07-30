import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vercel serves the built `dist/` as a static site and the `api/` folder as
// serverless functions. For full local parity (including /api/meta) run
// `vercel dev`; plain `vite` works too but title lookups fall back client-side.
export default defineConfig({
  plugins: [react()],
  server: {
    // This repo is worked on across several git worktrees at once, and Vite
    // pins 5173 for all of them — whichever tree starts second either fails or
    // silently lands on 5174 while its tooling still points at 5173, which
    // means testing one worktree's code against another's server. Tooling that
    // hands out a free port does it through PORT, which Vite doesn't read on
    // its own, so read it here. Unset (a plain `npm run dev`) is unchanged.
    port: Number(process.env.PORT) || 5173,
  },
});
