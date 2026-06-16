import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { getVersionConfig } from "./scripts/version-config";

const { appVersion, contractVersion } = getVersionConfig();

const stripGeneratedSourcemaps = {
  name: "strip-generated-sourcemaps",
  enforce: "pre" as const,
  load(id: string) {
    if (id.includes("/src/generated/") && (id.endsWith(".js") || id.endsWith(".mjs"))) {
      try {
        const code = readFileSync(id, "utf-8");
        return { code: code.replace(/\/\/# sourceMappingURL=\S+/g, ""), map: null };
      } catch { return null; }
    }
  },
};

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "./" : "/",
  plugins: [stripGeneratedSourcemaps, react(), wasm(), nodePolyfills({ include: ["crypto", "buffer", "stream", "util"] })],
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
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Midnight SDK imports fs/path/vm for Node-only code paths that never run in browser
        if (warning.message.includes("has been externalized for browser compatibility")) return;
        defaultHandler(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@midnight-ntwrk")) return "midnight-sdk";
        },
      },
    },
  },
});
