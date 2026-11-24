import { defineConfig } from "vite-plus";
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
  // Frontend tests only. Backend tests use node:test (`vp run test:server`).
  // Paths are relative to `root` (ui/).
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
  fmt: {
    printWidth: 100,
    ignorePatterns: ["web/**", ".ccglass/**", "docs/superpowers/**", "package-lock.json"],
  },
  lint: {
    ignorePatterns: ["web/**", ".ccglass/**"],
    options: { typeAware: true, typeCheck: true },
  },
  staged: {
    "*": "vp check --fix",
  },
});
