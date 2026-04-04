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
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/compact-runtime";
import { requestWalletPermissionsIfSupported } from "./wallet-permissions";
import { fromHex, toHex } from "./wallet-bridge";
import { createPatchedSdkPrivateStateProvider } from "./patched-private-state-provider";

const MANAGED_CONTRACT_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";

const PRIVATE_STATE_PASSWORD_ENV = (import.meta.env.VITE_PRIVATE_STATE_PASSWORD || "").trim();
const APP_LOCAL_STORAGE_PREFIX = "didmn:private-state:app-local:v1";

export type StorageMode = "app_local" | "patched_sdk";

interface AppLocalSerializedBytes {
  __type: "Uint8Array";
  data: number[];
}

interface AppLocalSerializedBigInt {
  __type: "BigInt";
  data: string;
}

function serializeAppLocalValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      __type: "Uint8Array",
      data: Array.from(value),
    } satisfies AppLocalSerializedBytes;
  }
  if (typeof value === "bigint") {
    return {
      __type: "BigInt",
      data: value.toString(10),
    } satisfies AppLocalSerializedBigInt;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeAppLocalValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeAppLocalValue(entry)]),
    );
  }
  return value;
}

function deserializeAppLocalValue<T>(value: unknown): T {
  if (!value || typeof value !== "object") {
    return value as T;
  }
  if (
    "__type" in value &&
    value.__type === "Uint8Array" &&
    "data" in value &&
    Array.isArray(value.data)
  ) {
    return new Uint8Array(value.data as number[]) as T;
  }
  if (
    "__type" in value &&
    value.__type === "BigInt" &&
    "data" in value &&
    typeof value.data === "string"
  ) {
    return BigInt(value.data) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deserializeAppLocalValue(entry)) as T;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, deserializeAppLocalValue(entry)]),
  ) as T;
}

function getAppLocalStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("App local private storage is only available in the browser.");
  }
  return window.localStorage;
}

function getAppLocalNamespace(accountId: string): string {
  return `${APP_LOCAL_STORAGE_PREFIX}:${accountId}`;
}

function createAppLocalPrivateStateProvider(accountId: string): PrivateStateProvider {
  const namespace = getAppLocalNamespace(accountId);
  let contractAddress: ContractAddress | null = null;

  const stateKey = (privateStateId: string): string => {
    if (contractAddress === null) {
      throw new Error("Contract address not set. Call setContractAddress() before accessing private state.");
    }
    return `${namespace}:state:${contractAddress}:${privateStateId}`;
  };

  const signingKeyKey = (address: ContractAddress): string =>
    `${namespace}:signing-key:${address}`;

  const forEachNamespacedKey = (
    prefix: string,
    callback: (key: string) => void,
  ): void => {
    const storage = getAppLocalStorage();
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    keys.forEach(callback);
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    async get(privateStateId: string) {
      const raw = getAppLocalStorage().getItem(stateKey(privateStateId));
      if (!raw) return null;
      return deserializeAppLocalValue(JSON.parse(raw));
    },
    async set(privateStateId: string, state: unknown) {
      getAppLocalStorage().setItem(
        stateKey(privateStateId),
        JSON.stringify(serializeAppLocalValue(state)),
      );
    },
    async remove(privateStateId: string) {
      getAppLocalStorage().removeItem(stateKey(privateStateId));
    },
    async clear() {
      if (contractAddress === null) {
        throw new Error("Contract address not set. Call setContractAddress() before accessing private state.");
      }
      forEachNamespacedKey(`${namespace}:state:${contractAddress}:`, (key) => {
        getAppLocalStorage().removeItem(key);
      });
    },
    async getSigningKey(address: ContractAddress) {
      const raw = getAppLocalStorage().getItem(signingKeyKey(address));
      if (!raw) return null;
      return deserializeAppLocalValue<SigningKey>(JSON.parse(raw));
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
      getAppLocalStorage().setItem(
        signingKeyKey(address),
        JSON.stringify(serializeAppLocalValue(signingKey)),
      );
    },
    async removeSigningKey(address: ContractAddress) {
      getAppLocalStorage().removeItem(signingKeyKey(address));
    },
    async clearSigningKeys() {
      forEachNamespacedKey(`${namespace}:signing-key:`, (key) => {
        getAppLocalStorage().removeItem(key);
      });
    },
  } as PrivateStateProvider;
}

function getTemporaryPrivateStatePassword(accountId: string): string {
  if (PRIVATE_STATE_PASSWORD_ENV) {
    return PRIVATE_STATE_PASSWORD_ENV;
  }

  // Temporary smoke-test password source so the browser Level provider can be exercised locally.
  return `DidMn!BrowserSmoke2026#${accountId}`;
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

interface BuildProvidersOptions {
  reconnect?: () => Promise<ConnectedAPI>;
  onReconnect?: (api: ConnectedAPI) => void;
  storageMode?: StorageMode;
}

async function ensureWalletSession(api: ConnectedAPI): Promise<void> {
  await requestWalletPermissionsIfSupported(api);
}

function isWalletDisconnectedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return /not connected to wallet/i.test(message);
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

export async function buildProviders(
  api: ConnectedAPI,
  options: BuildProvidersOptions = {},
): Promise<AppProviders> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId as never);
  const shielded = await api.getShieldedAddresses();
  const unshielded = await api.getUnshieldedAddress();

  const accountId = `${config.networkId}:${unshielded.unshieldedAddress}`;
  const managedContractUrl = getManagedContractUrl();

  const zkConfigProvider = new NormalizedFetchZkConfigProvider(managedContractUrl);

  const keyMaterialProvider: KeyMaterialProvider = {
    getZKIR: async (circuitId) => zkConfigProvider.getZKIR(circuitId),
    getProverKey: async (circuitId) => zkConfigProvider.getProverKey(circuitId),
    getVerifierKey: async (circuitId) =>
      zkConfigProvider.getVerifierKey(circuitId),
  };

  let currentApi = api;

  const withWalletRetry = async <T>(operation: (connectedApi: ConnectedAPI) => Promise<T>): Promise<T> => {
    try {
      await ensureWalletSession(currentApi);
      return await operation(currentApi);
    } catch (error) {
      if (!isWalletDisconnectedError(error) || !options.reconnect) {
        throw error;
      }

      currentApi = await options.reconnect();
      options.onReconnect?.(currentApi);
      await ensureWalletSession(currentApi);
      return operation(currentApi);
    }
  };

  const connectedApiProxy = new Proxy({} as ConnectedAPI, {
    get(_target, prop) {
      const currentValue = Reflect.get(currentApi as object, prop);
      if (typeof currentValue !== "function") {
        return currentValue;
      }

      return (...args: unknown[]) =>
        withWalletRetry((connectedApi) =>
          Reflect.apply(
            Reflect.get(connectedApi as object, prop) as (...innerArgs: unknown[]) => unknown,
            connectedApi,
            args,
          ) as Promise<unknown>,
        );
    },
  }) as ConnectedAPI;

  const provingProvider = {
    check: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
    ): Promise<(bigint | undefined)[]> => {
      return withWalletRetry(async (connectedApi) => {
        const freshProvider = await connectedApi.getProvingProvider(keyMaterialProvider);
        return freshProvider.check(serializedPreimage, keyLocation);
      });
    },
    prove: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> => {
      return withWalletRetry(async (connectedApi) => {
        const freshProvider = await connectedApi.getProvingProvider(keyMaterialProvider);
        return freshProvider.prove(
          serializedPreimage,
          keyLocation,
          overwriteBindingInput,
        );
      });
    },
  };

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey as never,
    getEncryptionPublicKey: () =>
      shielded.shieldedEncryptionPublicKey as never,
    async balanceTx(tx) {
      const result = await withWalletRetry((connectedApi) =>
        connectedApi.balanceUnsealedTransaction(toHex(tx.serialize()), {
          payFees: true,
        }),
      );
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
      await withWalletRetry(async (connectedApi) => {
        await connectedApi.submitTransaction(toHex(tx.serialize()));
      });
      const [identifier] = tx.identifiers();
      return identifier;
    },
  };

  const storageMode = options.storageMode || "app_local";
  const privateStateProvider =
    storageMode === "patched_sdk"
      ? createPatchedSdkPrivateStateProvider({
          accountId,
          privateStoragePasswordProvider: () =>
            getTemporaryPrivateStatePassword(accountId),
        })
      : createAppLocalPrivateStateProvider(accountId);

  return {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
      WebSocket as never,
    ),
    zkConfigProvider,
    proofProvider: createProofProvider(provingProvider as never),
    walletProvider,
    midnightProvider,
    connectedAPI: connectedApiProxy,
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
