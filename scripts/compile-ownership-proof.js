#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contractPath = resolve(__dirname, "../contracts/native_ownership_proof.compact");
const contractTemplatePath = resolve(
  __dirname,
  "../contracts/native_ownership_proof.compact.template",
);
const managedDir = resolve(__dirname, "../contracts/managed/native-ownership-proof");
const publicManagedDir = resolve(
  __dirname,
  "../public/contracts/managed/native-ownership-proof",
);
const generatedSourceDir = resolve(__dirname, "../src/generated");
const generatedRuntimeJsPath = resolve(
  generatedSourceDir,
  "nativeOwnershipProof.runtime.js",
);
const generatedRuntimeDtsPath = resolve(
  generatedSourceDir,
  "nativeOwnershipProof.runtime.d.ts",
);
const generatedRuntimeMapPath = resolve(
  generatedSourceDir,
  "nativeOwnershipProof.runtime.js.map",
);

function renderContractSource() {
  cpSync(contractTemplatePath, contractPath);
}

function runCompiler(binary) {
  return spawnSync(binary, ["compile", contractPath, managedDir], {
    stdio: "inherit",
  });
}

function ensureManagedOutput() {
  const managedContractJs = resolve(managedDir, "contract/index.js");
  const managedContractDts = resolve(managedDir, "contract/index.d.ts");
  const managedContractMap = resolve(managedDir, "contract/index.js.map");

  if (!existsSync(managedContractJs)) {
    throw new Error(
      "Compact compile did not produce contracts/managed/native-ownership-proof/contract/index.js",
    );
  }

  rmSync(publicManagedDir, { force: true, recursive: true });
  mkdirSync(resolve(__dirname, "../public/contracts/managed"), {
    recursive: true,
  });
  cpSync(managedDir, publicManagedDir, { recursive: true });

  mkdirSync(generatedSourceDir, { recursive: true });
  const generatedRuntimeJs = readFileSync(managedContractJs, "utf8").replace(
    /\/\/# sourceMappingURL=index\.js\.map\s*$/,
    "//# sourceMappingURL=nativeOwnershipProof.runtime.js.map",
  );
  writeFileSync(generatedRuntimeJsPath, generatedRuntimeJs);
  if (existsSync(managedContractDts)) {
    cpSync(managedContractDts, generatedRuntimeDtsPath);
  }
  if (existsSync(managedContractMap)) {
    cpSync(managedContractMap, generatedRuntimeMapPath);
  }
}

try {
  renderContractSource();

  const firstAttempt = runCompiler("compact");
  if (firstAttempt.error && firstAttempt.error.code === "ENOENT") {
    const secondAttempt = runCompiler("compactc");
    if (secondAttempt.error && secondAttempt.error.code === "ENOENT") {
      throw new Error(
        "Compact compiler not found. Install the official `compact` or `compactc` binary, then rerun `npm run compile-ownership-proof`.",
      );
    }
    if (secondAttempt.status !== 0) {
      process.exit(secondAttempt.status ?? 1);
    }
  } else if (firstAttempt.status !== 0) {
    process.exit(firstAttempt.status ?? 1);
  }

  ensureManagedOutput();

  console.log(`✅ Compiled: ${contractPath}`);
  console.log(`📦 Managed output: ${managedDir}`);
  console.log(`🌐 Browser assets: ${publicManagedDir}`);
} catch (error) {
  console.error(
    "❌ Compilation failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
