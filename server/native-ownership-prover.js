import "./load-env.js";
import { readFile } from "fs/promises";
import { resolve } from "path";
import {
  createProverKey,
  createVerifierKey,
  createZKIR,
  ZKConfigProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { httpClientProvingProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";

// ---------------------------------------------------------------------------
// Network-aware proof server URL priority
//
// preprod : 1AM cloud → midnight.network backup → (local if set)
// preview : 1AM cloud → (local if set)
// mainnet : 1AM cloud → local (Lace does not provide a mainnet proof server)
// undeployed : local only
//
// Override any tier via env vars; set to empty string to skip that tier.
// ---------------------------------------------------------------------------

const LOCAL_URL = (process.env.PROVER_SERVER_URI_LOCAL || "http://127.0.0.1:6300").trim();

const PROOF_SERVER_URLS_BY_NETWORK = {
  preprod: [
    (process.env.PROVER_SERVER_URI_PREPROD  || "https://api-preprod.1am.xyz").trim(),
    (process.env.PROVER_SERVER_URI_PREPROD_BACKUP || "https://proof-server.preprod.midnight.network").trim(),
  ].filter(Boolean),

  preview: [
    (process.env.PROVER_SERVER_URI_PREVIEW  || "https://api-preview.1am.xyz").trim(),
  ].filter(Boolean),

  mainnet: [
    (process.env.PROVER_SERVER_URI_MAINNET  || "https://api.1am.xyz").trim(),
    LOCAL_URL,
  ].filter(Boolean),

  undeployed: [
    LOCAL_URL,
  ].filter(Boolean),
};

// Legacy single-URL env var — kept for backward compatibility.
const PROVER_SERVER_URL_LEGACY = (
  process.env.PROVER_SERVER_URI ||
  process.env.VITE_PROVER_SERVER_URI ||
  ""
).trim();

function getCandidateUrls(network, extraFallback) {
  const byNetwork = PROOF_SERVER_URLS_BY_NETWORK[network] || [];
  const legacy = PROVER_SERVER_URL_LEGACY ? [PROVER_SERVER_URL_LEGACY] : [];
  const extra = extraFallback ? [extraFallback] : [];
  return [...new Set([...byNetwork, ...legacy, ...extra])].filter(Boolean);
}

class FileZkConfigProvider extends ZKConfigProvider {
  constructor(baseDir) {
    super();
    this.baseDir = baseDir;
  }

  async getZKIR(circuitId) {
    return createZKIR(
      await readFile(resolve(this.baseDir, "zkir", `${circuitId}.bzkir`)),
    );
  }

  async getProverKey(circuitId) {
    return createProverKey(
      await readFile(resolve(this.baseDir, "keys", `${circuitId}.prover`)),
    );
  }

  async getVerifierKey(circuitId) {
    return createVerifierKey(
      await readFile(resolve(this.baseDir, "keys", `${circuitId}.verifier`)),
    );
  }
}

const provingProviderCache = new Map();

function getProofArtifactsBaseDir() {
  return resolve(
    process.cwd(),
    "contracts",
    "managed",
    "native-ownership-proof",
  );
}

export function isNativeOwnershipVerificationAvailable() {
  return (
    Boolean(PROVER_SERVER_URL_LEGACY) ||
    Object.values(PROOF_SERVER_URLS_BY_NETWORK).some((urls) => urls.length > 0)
  );
}

async function getProvingProvider(url) {
  if (!provingProviderCache.has(url)) {
    const zkConfigProvider = new FileZkConfigProvider(getProofArtifactsBaseDir());
    provingProviderCache.set(
      url,
      Promise.resolve(httpClientProvingProvider(url, zkConfigProvider)),
    );
  }
  return provingProviderCache.get(url);
}

export async function proveNativeOwnership(
  serializedPreimage,
  keyLocation,
  options = {},
) {
  const candidateUrls = getCandidateUrls(options.network || "", options.fallbackProverUrl);

  if (candidateUrls.length === 0) {
    throw new Error("Native proof verification is not configured on the server.");
  }

  let lastError;
  for (const url of candidateUrls) {
    try {
      const provingProvider = await getProvingProvider(url);
      return await provingProvider.prove(serializedPreimage, keyLocation);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Native proof verification failed.");
}

export async function checkNativeOwnership(
  serializedPreimage,
  keyLocation,
  options = {},
) {
  const candidateUrls = getCandidateUrls(options.network || "", options.fallbackProverUrl);

  if (candidateUrls.length === 0) {
    throw new Error("Native proof verification is not configured on the server.");
  }

  let lastError;
  for (const url of candidateUrls) {
    try {
      console.log(`[native-ownership-prover] trying proof server: ${url}`);
      const provingProvider = await getProvingProvider(url);
      return await provingProvider.check(serializedPreimage, keyLocation);
    } catch (error) {
      console.log(`[native-ownership-prover] ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Native proof verification failed.");
}
