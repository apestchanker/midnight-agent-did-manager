import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");

export function getVersionConfig() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const appVersion = String(packageJson.version || "").trim();
  const contractVersion = String(packageJson.contractVersion || "").trim();

  if (!appVersion) {
    throw new Error(
      "Missing package.json version. Define the app version in package.json.",
    );
  }
  if (!contractVersion) {
    throw new Error(
      "Missing package.json contractVersion. Define the contract version in package.json.",
    );
  }

  return {
    appVersion,
    contractVersion,
  };
}
