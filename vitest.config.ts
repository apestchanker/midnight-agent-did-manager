import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
  test: {
    setupFiles: ["./tests/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/dist/**",
      "**/artifacts/**",
    ],
  },
});
