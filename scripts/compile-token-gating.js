#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contractPath = resolve(__dirname, "../contracts/token_gating.compact");
const managedDir = resolve(__dirname, "../contracts/managed/token-gating");
const publicManagedDir = resolve(__dirname, "../public/contracts/managed/token-gating");
const generatedSourceDir = resolve(__dirname, "../src/generated");
const generatedRuntimeJsPath = resolve(generatedSourceDir, "tokenGatingContract.runtime.js");
const generatedRuntimeDtsPath = resolve(generatedSourceDir, "tokenGatingContract.runtime.d.ts");

const CIRCUITS = ["mint_capability_tokens", "consume_token_for_action"];

function runCompiler(binary) {
  rmSync(managedDir, { force: true, recursive: true });
  return spawnSync(binary, ["compile", contractPath, managedDir], {
    stdio: "inherit",
  });
}

function ensureManagedOutput() {
  const managedContractJs = resolve(managedDir, "contract/index.js");
  const managedContractDts = resolve(managedDir, "contract/index.d.ts");

  if (!existsSync(managedContractJs)) {
    throw new Error(
      "Compact compile did not produce contracts/managed/token-gating/contract/index.js",
    );
  }

  rmSync(publicManagedDir, { force: true, recursive: true });
  mkdirSync(resolve(__dirname, "../public/contracts/managed"), { recursive: true });
  cpSync(managedDir, publicManagedDir, { recursive: true });

  mkdirSync(generatedSourceDir, { recursive: true });
  cpSync(managedContractJs, generatedRuntimeJsPath);
  if (existsSync(managedContractDts)) {
    cpSync(managedContractDts, generatedRuntimeDtsPath);
  }

  createCircuitAliases(managedDir);
  createCircuitAliases(publicManagedDir);
}

function createCircuitAliases(baseDir) {
  const keysDir = resolve(baseDir, "keys");
  const zkirDir = resolve(baseDir, "zkir");
  const contractTag = "token-gating";

  if (!existsSync(keysDir)) return;

  for (const circuit of CIRCUITS) {
    for (const ext of [".prover", ".verifier"]) {
      const source = resolve(keysDir, `${circuit}${ext}`);
      const target = resolve(keysDir, `${contractTag}#${circuit}${ext}`);
      if (existsSync(source) && !existsSync(target)) {
        cpSync(source, target);
      }
    }
    for (const ext of [".bzkir", ".zkir"]) {
      const source = resolve(zkirDir, `${circuit}${ext}`);
      const target = resolve(zkirDir, `${contractTag}#${circuit}${ext}`);
      if (existsSync(source) && !existsSync(target)) {
        cpSync(source, target);
      }
    }
  }
}

const firstAttempt = runCompiler("compact");
if (firstAttempt.error && firstAttempt.error.code === "ENOENT") {
  const secondAttempt = runCompiler("compactc");
  if (secondAttempt.error && secondAttempt.error.code === "ENOENT") {
    throw new Error(
      "Compact compiler not found. Install the official `compact` or `compactc` binary.",
    );
  }
  if (secondAttempt.status !== 0) process.exit(secondAttempt.status ?? 1);
} else if (firstAttempt.status !== 0) {
  process.exit(firstAttempt.status ?? 1);
}

try {
  ensureManagedOutput();
  console.log(`✅ Compiled: ${contractPath}`);
  console.log(`📦 Managed output: ${managedDir}`);
  console.log(`🌐 Browser assets: ${publicManagedDir}`);
} catch (error) {
  console.error("❌ Compilation failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
