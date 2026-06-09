import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Host vite + docker api: default localhost:8000. Web in compose: set VITE_DEV_API_PROXY=http://api:8000.
const devApiProxy = process.env.VITE_DEV_API_PROXY?.trim() || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["vigil.cclab.cloud-castles.com"],
    proxy: {
      "/v1": { target: devApiProxy, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
});
