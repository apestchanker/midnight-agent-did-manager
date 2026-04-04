import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const envPaths = [
  resolve(repoRoot, ".env"),
  resolve(repoRoot, ".env.local"),
];

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

function loadFileEnv() {
  const env = {};

  for (const envPath of envPaths) {
    try {
      Object.assign(env, parseEnvFile(readFileSync(envPath, "utf-8")));
    } catch {
      // Ignore missing local env files.
    }
  }

  return env;
}

function resolveVersion(rawValue, fallback) {
  const normalized = (rawValue || "").trim();
  return normalized || fallback;
}

export function getVersionConfig() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const fileEnv = loadFileEnv();
  const mergedEnv = {
    ...fileEnv,
    ...process.env,
  };

  const appVersion = resolveVersion(
    mergedEnv.VITE_APP_VERSION || mergedEnv.APP_VERSION,
    packageJson.version,
  );
  const contractVersion = resolveVersion(
    mergedEnv.VITE_CONTRACT_VERSION || mergedEnv.CONTRACT_VERSION,
    appVersion,
  );

  return {
    appVersion,
    contractVersion,
  };
}
