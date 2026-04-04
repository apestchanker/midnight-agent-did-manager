import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { fileURLToPath, URL } from "node:url";
import { getVersionConfig } from "./scripts/version-config";

const { appVersion, contractVersion } = getVersionConfig();

export default defineConfig({
  plugins: [react(), wasm()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __CONTRACT_VERSION__: JSON.stringify(contractVersion),
  },
  resolve: {
    alias: {
      events: fileURLToPath(
        new URL("./node_modules/events/events.js", import.meta.url),
      ),
      "isomorphic-ws": fileURLToPath(
        new URL("./src/shims/isomorphic-ws.ts", import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ["events"],
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "esnext",
  },
});
