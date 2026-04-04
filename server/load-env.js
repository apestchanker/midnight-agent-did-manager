import { readFileSync } from "fs";
import { resolve } from "path";

export function parseEnvFile(content) {
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

export function applyEnv(parsed) {
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

export function loadEnvFiles(cwd = process.cwd()) {
  for (const path of [resolve(cwd, ".env"), resolve(cwd, ".env.local")]) {
    try {
      applyEnv(parseEnvFile(readFileSync(path, "utf8")));
    } catch {
      // Ignore missing env files.
    }
  }
}

loadEnvFiles();
