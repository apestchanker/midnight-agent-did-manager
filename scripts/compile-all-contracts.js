#!/usr/bin/env node
/**
 * Compiles all Compact contracts in the required order and refreshes all managed assets.
 * Run this after any contract source change or on a fresh clone.
 *
 * Order matters:
 *   1. token_gating.compact  — no deps; its address is passed to did_registry constructor
 *   2. did_registry.compact  — depends on token_gating being deployed (address known at runtime)
 *   3. native-ownership-proof (if present)
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(script, label) {
  console.log(`\n▶  ${label}`);
  const result = spawnSync("node", [resolve(__dirname, script)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run("compile-token-gating.js",    "Compiling token_gating.compact …");
  run("compile-contract.js",         "Compiling did_registry.compact …");
  run("compile-ownership-proof.js",  "Compiling native-ownership-proof.compact …");
  console.log("\n✅  All contracts compiled successfully.");
} catch (err) {
  console.error("\n❌  Compilation failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
