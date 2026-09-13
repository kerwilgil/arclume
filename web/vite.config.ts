import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Phase 10 local Web UI build. Output: web/dist (packed into the npm tarball).
export default defineConfig({
  root: ".",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
