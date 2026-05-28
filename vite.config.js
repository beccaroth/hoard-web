import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vercel serves the built `dist/` as a static site and the `api/` folder as
// serverless functions. For full local parity (including /api/meta) run
// `vercel dev`; plain `vite` works too but title lookups fall back client-side.
export default defineConfig({
  plugins: [react()],
});
