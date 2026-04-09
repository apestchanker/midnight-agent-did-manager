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

const PROVER_SERVER_URL =
  process.env.PROVER_SERVER_URI ||
  process.env.VITE_PROVER_SERVER_URI ||
  "";

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
  return Boolean(PROVER_SERVER_URL);
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
  const candidateUrls = [
    PROVER_SERVER_URL,
    options.fallbackProverUrl || "",
  ].filter(Boolean);

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
