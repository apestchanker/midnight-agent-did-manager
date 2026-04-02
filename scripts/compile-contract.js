#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contractPath = resolve(__dirname, "../contracts/did_registry.compact");
const managedDir = resolve(__dirname, "../contracts/managed/did-registry");
const publicManagedDir = resolve(
  __dirname,
  "../public/contracts/managed/did-registry",
);
const generatedSourceDir = resolve(__dirname, "../src/generated");
const generatedRuntimeJsPath = resolve(
  generatedSourceDir,
  "didRegistryContract.runtime.js",
);
const generatedRuntimeDtsPath = resolve(
  generatedSourceDir,
  "didRegistryContract.runtime.d.ts",
);
const compiledMetaDir = resolve(__dirname, "../contracts/compiled");
const compiledMetaPath = resolve(compiledMetaDir, "did_registry.compiled.json");
const CONTRACT_METADATA_VERSION = "0.2.0";
const CIRCUITS = [
  "contract_version",
  "request_did",
  "issue_did",
  "request_update",
  "update_did",
  "request_revoke",
  "revoke_did",
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
      "Compact compile did not produce contracts/managed/did-registry/contract/index.js",
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
  const contractTag = "did-registry";

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
        name: "did_registry",
        source: sourceCode,
        compiledAt: new Date().toISOString(),
        format: "compact-managed",
        metadata: {
          circuits: [
            ...CIRCUITS,
          ],
          ledgerVariables: [
            "initialized",
            "registry_admin",
            "issuer_service",
            "total_requests",
            "total_active_dids",
            "status_by_agent",
            "request_commitments",
            "update_request_commitments",
            "revocation_request_commitments",
            "did_commitments",
            "document_commitments",
            "proof_commitments",
            "organization_labels",
            "organization_disclosures",
            "revocation_commitments",
            "registry_nonce",
          ],
          targetNetwork: process.env.VITE_NETWORK_ID || "preprod",
          deploymentReady: true,
          managedContractPath: "/contracts/managed/did-registry",
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
        "Compact compiler not found. Install the official `compact` or `compactc` binary, then rerun `npm run compile-contract`.",
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
