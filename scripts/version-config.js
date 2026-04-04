import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const envPath = resolve(repoRoot, ".env");

function parseEnvFile(content) {
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function resolveVersion(rawValue, key) {
  const normalized = (rawValue || "").trim();
  if (!normalized) {
    throw new Error(
      `Missing required ${key} in .env. Define both VITE_APP_VERSION and VITE_CONTRACT_VERSION in /Users/alex/Documents/Developer/didMN/.env.`,
    );
  }
  return normalized;
}

export function getVersionConfig() {
  let fileEnv;
  try {
    fileEnv = parseEnvFile(readFileSync(envPath, "utf-8"));
  } catch {
    throw new Error(
      "Missing .env file. Define VITE_APP_VERSION and VITE_CONTRACT_VERSION in /Users/alex/Documents/Developer/didMN/.env.",
    );
  }

  const appVersion = resolveVersion(fileEnv.VITE_APP_VERSION, "VITE_APP_VERSION");
  const contractVersion = resolveVersion(
    fileEnv.VITE_CONTRACT_VERSION,
    "VITE_CONTRACT_VERSION",
  );

  return {
    appVersion,
    contractVersion,
  };
}
