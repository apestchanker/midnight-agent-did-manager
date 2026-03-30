#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const checks = [
  {
    label: "Managed contract module",
    ok: existsSync(
      resolve(
        __dirname,
        "../public/contracts/managed/did-registry/contract/index.js",
      ),
    ),
    help: "Run `npm run compile-contract` after installing the Compact compiler.",
  },
  {
    label: "Managed proving keys",
    ok: existsSync(
      resolve(__dirname, "../public/contracts/managed/did-registry/keys"),
    ),
    help: "The managed build must include `keys/` for each circuit.",
  },
  {
    label: "Managed ZKIR assets",
    ok: existsSync(
      resolve(__dirname, "../public/contracts/managed/did-registry/zkir"),
    ),
    help: "The managed build must include `zkir/` for each circuit.",
  },
];

let allGood = true;
for (const check of checks) {
  if (check.ok) {
    console.log(`✅ ${check.label}`);
  } else {
    allGood = false;
    console.log(`❌ ${check.label}`);
    console.log(`   ${check.help}`);
  }
}

if (!allGood) {
  process.exit(1);
}
