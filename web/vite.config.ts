import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Host vite + docker api: default localhost:8000. Web in compose: set VITE_DEV_API_PROXY=http://api:8000.
const devApiProxy = process.env.VITE_DEV_API_PROXY?.trim() || "http://127.0.0.1:8000";

/** SPA routes share prefixes with public API paths — only proxy JSON/API fetches. */
function apiProxyBypass(req: { headers?: { accept?: string }; url?: string }) {
  const accept = req.headers?.accept ?? "";
  if (accept.includes("text/html")) {
    return req.url;
  }
}

/** Forward the browser client IP so the API can resolve session geolocation in dev. */
function forwardClientIp(proxy: { on: (event: string, listener: (...args: unknown[]) => void) => void }) {
  proxy.on("proxyReq", (proxyReq, req) => {
    const addr = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
    if (addr) {
      (proxyReq as { setHeader: (name: string, value: string) => void }).setHeader(
        "X-Forwarded-For",
        addr,
      );
    }
  });
}

const devProxy = {
  target: devApiProxy,
  changeOrigin: true,
  configure: forwardClientIp,
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["app.veritrail.io"],
    proxy: {
      "/v1": devProxy,
      "/uploads": devProxy,
      "/trust": { ...devProxy, bypass: apiProxyBypass },
      "/auditor": { ...devProxy, bypass: apiProxyBypass },
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
