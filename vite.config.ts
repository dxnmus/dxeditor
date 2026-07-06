import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend lives in web/. In dev, API calls are proxied to the Node server.
// In build, output goes to dist/ which the Node server serves in production.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
