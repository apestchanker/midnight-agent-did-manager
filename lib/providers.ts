import { Transaction } from "@midnight-ntwrk/ledger-v8";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  createProverKey,
  createProofProvider,
  createVerifierKey,
  createZKIR,
  type MidnightProvider,
  type MidnightProviders,
  type PrivateStateProvider,
  type WalletProvider,
  ZKConfigProvider,
} from "@midnight-ntwrk/midnight-js-types";
import type {
  ConnectedAPI,
  KeyMaterialProvider,
} from "@midnight-ntwrk/dapp-connector-api";
import { fromHex, toHex } from "./wallet-bridge";

const MANAGED_CONTRACT_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";

const PRIVATE_STATE_NS = "midnight-did:private-state-password:v1";

function createBrowserPrivateStateProvider(
  accountId: string,
): PrivateStateProvider {
  const stateStore = new Map<string, unknown>();
  const signingKeyStore = new Map<string, unknown>();
  let currentContractAddress = "";

  const scopedKey = (privateStateId: string) =>
    `${accountId}:${currentContractAddress}:${privateStateId}`;

  return {
    setContractAddress(address) {
      currentContractAddress = String(address);
    },
    async set(privateStateId, state) {
      stateStore.set(scopedKey(privateStateId), state);
    },
    async get(privateStateId) {
      return (stateStore.get(scopedKey(privateStateId)) as never) ?? null;
    },
    async remove(privateStateId) {
      stateStore.delete(scopedKey(privateStateId));
    },
    async clear() {
      for (const key of [...stateStore.keys()]) {
        if (key.startsWith(`${accountId}:${currentContractAddress}:`)) {
          stateStore.delete(key);
        }
      }
    },
    async setSigningKey(address, signingKey) {
      signingKeyStore.set(String(address), signingKey);
    },
    async getSigningKey(address) {
      return (signingKeyStore.get(String(address)) as never) ?? null;
    },
    async removeSigningKey(address) {
      signingKeyStore.delete(String(address));
    },
    async clearSigningKeys() {
      signingKeyStore.clear();
    },
    async exportPrivateStates() {
      throw new Error("Private state export is not implemented in the browser adapter.");
    },
    async importPrivateStates() {
      throw new Error("Private state import is not implemented in the browser adapter.");
    },
    async exportSigningKeys() {
      throw new Error("Signing key export is not implemented in the browser adapter.");
    },
    async importSigningKeys() {
      throw new Error("Signing key import is not implemented in the browser adapter.");
    },
  };
}

export interface AppProviders extends MidnightProviders<string> {
  connectedAPI: ConnectedAPI;
  networkId: string;
  indexerUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  proverServerUrl?: string;
  shieldedAddress: string;
  unshieldedAddress: string;
  zkArtifactsBaseUrl: string;
}

async function ensureWalletSession(api: ConnectedAPI): Promise<void> {
  await api.hintUsage([
    "getConfiguration",
    "getShieldedAddresses",
    "getUnshieldedAddress",
    "getProvingProvider",
    "balanceUnsealedTransaction",
    "submitTransaction",
  ]);
}

function getPrivateStatePassword(accountId: string, networkId: string): string {
  if (typeof window === "undefined") {
    return `${PRIVATE_STATE_NS}:${networkId}:${accountId}`.padEnd(32, "0");
  }

  const key = `${PRIVATE_STATE_NS}:${networkId}:${accountId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const password = toHex(bytes);
  window.localStorage.setItem(key, password);
  return password;
}

function getManagedContractUrl(): string {
  if (typeof window === "undefined") {
    return MANAGED_CONTRACT_PATH;
  }

  return new URL(MANAGED_CONTRACT_PATH, window.location.origin).toString();
}

function normalizeCircuitId(circuitId: string): string {
  const [, localName = circuitId] = circuitId.split("#");
  return localName;
}

class NormalizedFetchZkConfigProvider extends ZKConfigProvider<string> {
  constructor(private readonly baseUrl: string) {
    super();
  }

  private async fetchBytes(path: string): Promise<Uint8Array> {
    const response = await fetch(path, { method: "GET" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  private async fetchCircuitArtifact(
    folder: "keys" | "zkir",
    extension: string,
    circuitId: string,
  ): Promise<Uint8Array> {
    const candidates = Array.from(
      new Set([circuitId, normalizeCircuitId(circuitId)]),
    );

    let lastError: unknown;
    for (const candidate of candidates) {
      const encoded = encodeURIComponent(candidate);
      const url = `${this.baseUrl}/${folder}/${encoded}${extension}`;
      try {
        return await this.fetchBytes(url);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to read ${folder} artifact for ${circuitId}`);
  }

  async getZKIR(circuitId: string) {
    return createZKIR(
      await this.fetchCircuitArtifact("zkir", ".bzkir", circuitId),
    );
  }

  async getProverKey(circuitId: string) {
    return createProverKey(
      await this.fetchCircuitArtifact("keys", ".prover", circuitId),
    );
  }

  async getVerifierKey(circuitId: string) {
    return createVerifierKey(
      await this.fetchCircuitArtifact("keys", ".verifier", circuitId),
    );
  }
}

export async function buildProviders(api: ConnectedAPI): Promise<AppProviders> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId as never);
  const shielded = await api.getShieldedAddresses();
  const unshielded = await api.getUnshieldedAddress();

  const accountId = `${config.networkId}:${unshielded.unshieldedAddress}`;
  getPrivateStatePassword(unshielded.unshieldedAddress, config.networkId);
  const managedContractUrl = getManagedContractUrl();

  const zkConfigProvider = new NormalizedFetchZkConfigProvider(managedContractUrl);

  const keyMaterialProvider: KeyMaterialProvider = {
    getZKIR: async (circuitId) => zkConfigProvider.getZKIR(circuitId),
    getProverKey: async (circuitId) => zkConfigProvider.getProverKey(circuitId),
    getVerifierKey: async (circuitId) =>
      zkConfigProvider.getVerifierKey(circuitId),
  };

  const provingProvider = {
    check: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
    ): Promise<(bigint | undefined)[]> => {
      await ensureWalletSession(api);
      const freshProvider = await api.getProvingProvider(keyMaterialProvider);
      return freshProvider.check(serializedPreimage, keyLocation);
    },
    prove: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> => {
      await ensureWalletSession(api);
      const freshProvider = await api.getProvingProvider(keyMaterialProvider);
      return freshProvider.prove(
        serializedPreimage,
        keyLocation,
        overwriteBindingInput,
      );
    },
  };

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey as never,
    getEncryptionPublicKey: () =>
      shielded.shieldedEncryptionPublicKey as never,
    async balanceTx(tx) {
      await ensureWalletSession(api);
      const result = await api.balanceUnsealedTransaction(toHex(tx.serialize()), {
        payFees: true,
      });
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHex(result.tx),
      );
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx) {
      await ensureWalletSession(api);
      await api.submitTransaction(toHex(tx.serialize()));
      const [identifier] = tx.identifiers();
      return identifier;
    },
  };

  return {
    privateStateProvider: createBrowserPrivateStateProvider(accountId),
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
      WebSocket as never,
    ),
    zkConfigProvider,
    proofProvider: createProofProvider(provingProvider as never),
    walletProvider,
    midnightProvider,
    connectedAPI: api,
    networkId: config.networkId,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.substrateNodeUri,
    proverServerUrl: config.proverServerUri,
    shieldedAddress: shielded.shieldedAddress,
    unshieldedAddress: unshielded.unshieldedAddress,
    zkArtifactsBaseUrl: managedContractUrl,
  };
}
