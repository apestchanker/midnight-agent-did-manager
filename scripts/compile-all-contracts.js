#!/usr/bin/env node
/**
 * Compiles all Compact contracts and refreshes all managed assets.
 * Run this after any contract source change or on a fresh clone.
 *
 * As of v3.0.0 the token_gating.compact contract is unified into
 * did_registry.compact (see sdd/wip/unified-gated-did-registry/). The
 * standalone token_gating compile step was removed; token_gating.compact
 * is archived under contracts/archived/.
 *
 * Contracts:
 *   1. did_registry.compact         — unified gated DID registry (v3)
 *   2. native-ownership-proof       — if present
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
  run("compile-contract.js",         "Compiling did_registry.compact (unified v3) …");
  run("compile-ownership-proof.js",  "Compiling native-ownership-proof.compact …");
  console.log("\n✅  All contracts compiled successfully.");
} catch (err) {
  console.error("\n❌  Compilation failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
