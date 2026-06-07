#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contractPath = resolve(__dirname, "../contracts/reputation_registry.compact");
const managedDir = resolve(__dirname, "../contracts/managed/reputation-registry");
const publicManagedDir = resolve(
  __dirname,
  "../public/contracts/managed/reputation-registry",
);
const generatedSourceDir = resolve(__dirname, "../src/generated");
const generatedRuntimeJsPath = resolve(
  generatedSourceDir,
  "reputationRegistryContract.runtime.js",
);
const generatedRuntimeDtsPath = resolve(
  generatedSourceDir,
  "reputationRegistryContract.runtime.d.ts",
);
const compiledMetaDir = resolve(__dirname, "../contracts/compiled");
const compiledMetaPath = resolve(compiledMetaDir, "reputation_registry.compiled.json");
const CONTRACT_METADATA_VERSION = "0.2.0";
const CIRCUITS = [
  "rotate_issuer",
  "update_score",
  "suspend_score",
  "revoke_score",
  "restore_score",
  "get_tier",
  "meets_threshold",
  "get_score",
  "get_status",
];

function runCompiler(binary) {
  return spawnSync(binary, ["compile", contractPath, managedDir], {
    stdio: "inherit",
  });
}

function ensureManagedOutput() {
  const managedContractJs = resolve(managedDir, "contract/index.js");
  const managedContractDts = resolve(managedDir, "contract/index.d.ts");

  if (!existsSync(managedContractJs)) {
    throw new Error(
      "Compact compile did not produce contracts/managed/reputation-registry/contract/index.js",
    );
  }

  rmSync(publicManagedDir, { force: true, recursive: true });
  mkdirSync(resolve(__dirname, "../public/contracts/managed"), {
    recursive: true,
  });
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
  const contractTag = "reputation-registry";

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

function writeMetadata() {
  mkdirSync(compiledMetaDir, { recursive: true });
  const sourceCode = readFileSync(contractPath, "utf-8");

  writeFileSync(
    compiledMetaPath,
    JSON.stringify(
      {
        version: CONTRACT_METADATA_VERSION,
        name: "reputation_registry",
        source: sourceCode,
        compiledAt: new Date().toISOString(),
        format: "compact-managed",
        metadata: {
          circuits: [...CIRCUITS],
          ledgerVariables: [
            "initialized",
            "registry_admin",
            "issuer_service",
            "scores",
            "evidence_commitments",
            "last_update_epoch",
            "reputation_status",
            "total_active",
            "issuer_nonce",
          ],
          targetNetwork: process.env.VITE_NETWORK_ID || "preprod",
          deploymentReady: true,
          managedContractPath: "/contracts/managed/reputation-registry",
        },
      },
      null,
      2,
    ),
  );
}

try {
  const firstAttempt = runCompiler("compact");
  if (firstAttempt.error && firstAttempt.error.code === "ENOENT") {
    const secondAttempt = runCompiler("compactc");
    if (secondAttempt.error && secondAttempt.error.code === "ENOENT") {
      throw new Error(
        "Compact compiler not found. Install the official `compact` or `compactc` binary, then rerun `npm run compile-reputation`.",
      );
    }
    if (secondAttempt.status !== 0) {
      process.exit(secondAttempt.status ?? 1);
    }
  } else if (firstAttempt.status !== 0) {
    process.exit(firstAttempt.status ?? 1);
  }

  ensureManagedOutput();
  writeMetadata();

  console.log(`✅ Compiled: ${contractPath}`);
  console.log(`📦 Managed output: ${managedDir}`);
  console.log(`🌐 Browser assets: ${publicManagedDir}`);
  console.log(`📝 Metadata: ${compiledMetaPath}`);
} catch (error) {
  console.error(
    "❌ Compilation failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
