import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

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
  plugins: [stripGeneratedSourcemaps],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

