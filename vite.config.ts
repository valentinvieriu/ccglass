import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dashboardTarget = `http://127.0.0.1:${process.env.CCGLASS_DASHBOARD_PORT || "6657"}`;

export default defineConfig({
  root: "ui",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: dashboardTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            // The local dashboard protects mutations with an exact origin check.
            // Rewrite only forwarded requests inside this loopback dev proxy.
            if (req.headers.origin) proxyReq.setHeader("origin", dashboardTarget);
          });
        },
      },
    },
  },
});
