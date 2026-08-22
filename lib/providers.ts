import { Transaction, type ProvingProvider } from "@midnight-ntwrk/ledger-v8";
import { httpClientProvingProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
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
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/compact-runtime";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { requestWalletPermissionsIfSupported } from "./wallet-permissions";
import { fromHex, toHex } from "./wallet-bridge";

// Diagnostic logging added 2026-07-23 while debugging a "Unexpected error
// submitting scoped transaction '<unnamed>': Error" failure from
// gated_self_register_did: midnight-js-contracts wraps whatever the wallet
// connector throws with `String(err)`, which collapses a bare `new Error()`
// (no message) down to the literal text "Error" -- all diagnostic
// information is lost at that wrapping point. This logs the RAW error
// (message, name, stack, cause chain, and any non-standard own properties)
// at the actual call site, before it reaches that wrapper, so a future
// failure is actually debuggable instead of opaque.
// Deeply walks an arbitrary value (Error, Effect-TS FiberFailure/Cause,
// plain object, whatever the wallet connector actually throws) into a
// plain JSON-serializable tree, so it can be logged as a single STRING via
// JSON.stringify rather than a lazily-expandable console object reference.
// The first attempt at this (a shallow error.cause walk) printed
// `cause_0: {value: {…}}` — still collapsed, still useless when copy-pasted
// from the console. This recurses through own properties (including
// non-enumerable ones on Error/its prototype chain) up to a bounded depth,
// with cycle detection, and stringifies BigInt/Uint8Array/Map/Set so
// nothing gets silently dropped by JSON.stringify's defaults.
export function deepSerializeForLog(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > 8) return "<max depth reached>";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return `<function ${value.name || "anonymous"}>`;
  if (value instanceof Uint8Array) return `<Uint8Array len=${value.length} hex=${Array.from(value.slice(0, 64)).map((b) => b.toString(16).padStart(2, "0")).join("")}${value.length > 64 ? "..." : ""}>`;
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "<circular>";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => deepSerializeForLog(v, seen, depth + 1));
  }
  if (value instanceof Map) {
    return { __type: "Map", entries: Array.from(value.entries()).map(([k, v]) => [deepSerializeForLog(k, seen, depth + 1), deepSerializeForLog(v, seen, depth + 1)]) };
  }
  if (value instanceof Set) {
    return { __type: "Set", values: Array.from(value.values()).map((v) => deepSerializeForLog(v, seen, depth + 1)) };
  }

  const out: Record<string, unknown> = {};
  if (value instanceof Error) {
    out.__errorName = value.name;
    out.__errorMessage = value.message;
    out.__errorStack = value.stack;
  }
  // Object.getOwnPropertyNames catches non-enumerable props too (Error.message
  // is non-enumerable, and Effect's FiberFailure/Cause classes commonly use
  // non-enumerable fields as well) -- plain `for...in`/Object.entries misses
  // exactly the properties we need here.
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "stack") continue; // already captured above for Errors, noisy otherwise
    try {
      out[key] = deepSerializeForLog((value as Record<string, unknown>)[key], seen, depth + 1);
    } catch (e) {
      out[key] = `<unreadable: ${e instanceof Error ? e.message : String(e)}>`;
    }
  }
  return out;
}

export function logRawWalletError(context: string, error: unknown, extra?: Record<string, unknown>): void {
  const payload = {
    context,
    ...extra,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    serialized: deepSerializeForLog(error),
  };
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2);
  } catch (e) {
    text = `<JSON.stringify failed: ${e instanceof Error ? e.message : String(e)}> raw=${String(error)}`;
  }
  // Logged as a single string (not an object) so the whole tree prints as
  // copy-pasteable text instead of a console object reference the next
  // person has to click through node by node.
  console.error(`[providers][RAW WALLET ERROR] ${context}\n${text}`);
}

const MANAGED_CONTRACT_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";
const NATIVE_OWNERSHIP_MANAGED_CONTRACT_PATH =
  (import.meta.env.VITE_NATIVE_OWNERSHIP_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/native-ownership-proof";
const CONFIGURED_PROVER_SERVER_URL = (import.meta.env.VITE_PROVER_SERVER_URI || "").trim();

// The indexer URL the wallet hands back from getConfiguration() is whatever
// that wallet vendor hosts, not necessarily an endpoint the dApp's own origin
// is allowed to call. 1AM's preprod build returns a pre-authenticated URL on
// api-preprod.1am.xyz that answers browser requests without an
// Access-Control-Allow-Origin header, which blocks every contract read the app
// makes — including the DID lookup for a selected agent — with no usable error,
// since a CORS rejection surfaces to JS only as a bare network failure.
//
// VITE_INDEXER_URI therefore takes priority over the wallet's value when it is
// set, mirroring how CONFIGURED_PROVER_SERVER_URL already overrides
// config.proverServerUri above. Leave it unset to keep the previous behaviour
// of trusting the wallet.
const CONFIGURED_INDEXER_URL = (import.meta.env.VITE_INDEXER_URI || "").trim();
const CONFIGURED_INDEXER_WS_URL = (import.meta.env.VITE_INDEXER_WS_URI || "").trim();

/**
 * Derives the websocket companion for a configured indexer URL, used only when
 * VITE_INDEXER_URI is set without an explicit VITE_INDEXER_WS_URI.
 *
 * The http and ws endpoints are always resolved as a pair: taking one from the
 * environment and the other from the wallet would point subscriptions at a
 * different host than queries, which is worse than either source alone.
 */
export function deriveIndexerWsUrl(indexerUrl: string): string {
  const trimmed = (indexerUrl || "").trim();
  if (!trimmed) return "";
  const withWsScheme = trimmed
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  return withWsScheme.replace(/\/+$/, "") + "/ws";
}

/**
 * Resolves the indexer endpoint pair, preferring the configured environment
 * values over the wallet-supplied ones. Exported for testing.
 */
export function resolveIndexerEndpoints(
  walletIndexerUri: string,
  walletIndexerWsUri: string,
  configuredIndexerUrl: string = CONFIGURED_INDEXER_URL,
  configuredIndexerWsUrl: string = CONFIGURED_INDEXER_WS_URL,
): { indexerUri: string; indexerWsUri: string; source: "configured_env" | "wallet" } {
  // Trimmed here as well as at the module constants, so a caller passing a
  // blank-but-present value gets the wallet fallback rather than an endpoint
  // that is technically truthy and entirely unusable.
  const configuredUrl = (configuredIndexerUrl || "").trim();
  const configuredWsUrl = (configuredIndexerWsUrl || "").trim();

  if (configuredUrl) {
    return {
      indexerUri: configuredUrl,
      indexerWsUri: configuredWsUrl || deriveIndexerWsUrl(configuredUrl),
      source: "configured_env",
    };
  }
  return {
    indexerUri: walletIndexerUri,
    indexerWsUri: walletIndexerWsUri,
    source: "wallet",
  };
}

const PRIVATE_STATE_PASSWORD_ENV = (import.meta.env.VITE_PRIVATE_STATE_PASSWORD || "").trim();
const APP_LOCAL_STORAGE_PREFIX = "didmn:private-state:app-local:v1";

export type StorageMode = "app_local" | "sdk_level";

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

function submittedTransactionId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of ["txId", "transactionId", "id", "hash", "txHash"]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function transactionIdentifier(tx: { identifiers?: () => unknown }): string | undefined {
  if (typeof tx.identifiers !== "function") {
    return undefined;
  }

  let identifiers: unknown;
  try {
    identifiers = tx.identifiers();
  } catch {
    return undefined;
  }
  if (Array.isArray(identifiers)) {
    const [identifier] = identifiers;
    return typeof identifier === "string" && identifier.trim()
      ? identifier.trim()
      : undefined;
  }
  if (
    identifiers &&
    typeof identifiers === "object" &&
    Symbol.iterator in identifiers
  ) {
    const iterator = (identifiers as Iterable<unknown>)[Symbol.iterator]();
    const first = iterator.next();
    return typeof first.value === "string" && first.value.trim()
      ? first.value.trim()
      : undefined;
  }

  return undefined;
}

async function resolveTransactionIdentifierFromHash(
  indexerUri: string,
  txHash: string | undefined,
): Promise<string | undefined> {
  if (!txHash || !/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return undefined;
  }

  const response = await fetch(indexerUri, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        "query TX_ID_QUERY($offset: TransactionOffset!) { transactions(offset: $offset) { ... on RegularTransaction { identifiers } } }",
      variables: { offset: { hash: txHash } },
    }),
  });
  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    data?: {
      transactions?: Array<{
        identifiers?: unknown;
      }>;
    };
  };
  const identifiers = payload.data?.transactions?.[0]?.identifiers;
  if (Array.isArray(identifiers)) {
    const [identifier] = identifiers;
    return typeof identifier === "string" && identifier.trim()
      ? identifier.trim()
      : undefined;
  }

  return undefined;
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
  circuitProvingProvider: ProvingProvider;
  networkId: string;
  indexerUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  proverServerUrl?: string;
  configuredProverServerUrl?: string;
  proofProviderSource: "configured_env" | "wallet";
  proofWarningRequired: boolean;
  indexerSource: "configured_env" | "wallet";
  shieldedAddress: string;
  shieldedCoinPublicKeyHex: string;
  unshieldedAddress: string;
  zkArtifactsBaseUrl: string;
}

interface ProofProviderStatus {
  source: "configured_env" | "wallet";
  proverServerUrl?: string;
  warningRequired: boolean;
}

interface BuildProvidersOptions {
  reconnect?: () => Promise<ConnectedAPI>;
  onReconnect?: (api: ConnectedAPI) => void;
  storageMode?: StorageMode;
  onProofProviderStatusChange?: (status: ProofProviderStatus) => void;
}

async function ensureWalletSession(api: ConnectedAPI): Promise<void> {
  await requestWalletPermissionsIfSupported(api);
}

function isWalletDisconnectedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return (
    /not connected to wallet/i.test(message) ||
    /connection timeout/i.test(message) ||
    /wallet bridge timeout/i.test(message) ||
    /request timed out/i.test(message) ||
    /timed out/i.test(message)
  );
}

function getManagedContractUrl(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function extractShieldedCoinPublicKeyHex(shieldedAddress: string, networkId: string): string {
  const parsed = MidnightBech32m.parse(shieldedAddress);
  if (parsed.type === "shield-cpk") {
    return toHex(
      (ShieldedCoinPublicKey.codec.decode(networkId as never, parsed) as { data: Uint8Array })
        .data,
    );
  }
  if (parsed.type === "shield-addr") {
    return toHex(
      (
        ShieldedAddress.codec.decode(networkId as never, parsed) as {
          coinPublicKey: { data: Uint8Array };
        }
      ).coinPublicKey.data,
    );
  }
  throw new Error(`Unsupported shielded address type: ${parsed.type}`);
}

function isLocalProverServerUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function normalizeCircuitId(circuitId: string): string {
  const [, localName = circuitId] = circuitId.split("#");
  return localName;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const sample = new TextDecoder()
    .decode(bytes.slice(0, 128))
    .trimStart()
    .toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html");
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
    const bytes = new Uint8Array(buffer);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || looksLikeHtml(bytes)) {
      throw new Error(
        `Expected ZK artifact bytes at ${path}, but received HTML. Check the managed contract path and dev server static asset routing.`,
      );
    }
    return bytes;
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

class CompositeFetchZkConfigProvider extends ZKConfigProvider<string> {
  constructor(private readonly providers: Array<{ match: (circuitId: string) => boolean; provider: NormalizedFetchZkConfigProvider }>) {
    super();
  }

  private getProvider(circuitId: string): NormalizedFetchZkConfigProvider {
    const match = this.providers.find((entry) => entry.match(circuitId));
    if (!match) {
      throw new Error(`No ZK artifact provider registered for ${circuitId}`);
    }
    return match.provider;
  }

  async getZKIR(circuitId: string) {
    return this.getProvider(circuitId).getZKIR(circuitId);
  }

  async getProverKey(circuitId: string) {
    return this.getProvider(circuitId).getProverKey(circuitId);
  }

  async getVerifierKey(circuitId: string) {
    return this.getProvider(circuitId).getVerifierKey(circuitId);
  }
}

export async function buildProviders(
  api: ConnectedAPI,
  options: BuildProvidersOptions = {},
): Promise<AppProviders> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId as never);
  const { indexerUri, indexerWsUri, source: indexerSource } = resolveIndexerEndpoints(
    config.indexerUri,
    config.indexerWsUri,
  );
  const shielded = await api.getShieldedAddresses();
  const unshielded = await api.getUnshieldedAddress();
  const shieldedCoinPublicKeyHex = extractShieldedCoinPublicKeyHex(
    shielded.shieldedAddress,
    config.networkId,
  );

  const accountId = `${config.networkId}:${unshielded.unshieldedAddress}`;
  const managedContractUrl = getManagedContractUrl(MANAGED_CONTRACT_PATH);
  const nativeOwnershipManagedContractUrl = getManagedContractUrl(
    NATIVE_OWNERSHIP_MANAGED_CONTRACT_PATH,
  );

  // mint_capability_tokens and gated_self_register_did now live in the unified
  // did-registry contract — no separate token-gating routing needed.
  const zkConfigProvider = new CompositeFetchZkConfigProvider([
    {
      match: (circuitId) => normalizeCircuitId(circuitId) === "prove_ownership",
      provider: new NormalizedFetchZkConfigProvider(nativeOwnershipManagedContractUrl),
    },
    {
      match: () => true,
      provider: new NormalizedFetchZkConfigProvider(managedContractUrl),
    },
  ]);

  const keyMaterialProvider: KeyMaterialProvider = {
    getZKIR: async (circuitId) => zkConfigProvider.getZKIR(circuitId),
    getProverKey: async (circuitId) => zkConfigProvider.getProverKey(circuitId),
    getVerifierKey: async (circuitId) =>
      zkConfigProvider.getVerifierKey(circuitId),
  };

  let currentApi = api;

  const withWalletRetry = async <T>(operation: (connectedApi: ConnectedAPI) => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      await ensureWalletSession(currentApi);
      const result = await operation(currentApi);
      console.debug("[providers] withWalletRetry succeeded", { durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      logRawWalletError("withWalletRetry (first attempt)", error, {
        durationMs: Date.now() - startedAt,
        willRetry: isWalletDisconnectedError(error) && !!options.reconnect,
      });
      if (!isWalletDisconnectedError(error) || !options.reconnect) {
        throw error;
      }

      const retryStartedAt = Date.now();
      try {
        currentApi = await options.reconnect();
        options.onReconnect?.(currentApi);
        await ensureWalletSession(currentApi);
        const result = await operation(currentApi);
        console.debug("[providers] withWalletRetry succeeded on retry", {
          durationMs: Date.now() - retryStartedAt,
        });
        return result;
      } catch (retryError) {
        logRawWalletError("withWalletRetry (retry attempt)", retryError, {
          durationMs: Date.now() - retryStartedAt,
        });
        throw retryError;
      }
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
  let appProviders: AppProviders | null = null;

  const emitProofProviderStatus = (source: "configured_env" | "wallet", proverServerUrl?: string) => {
    if (appProviders) {
      appProviders.proofProviderSource = source;
      appProviders.proverServerUrl =
        source === "wallet" ? proverServerUrl : config.proverServerUri;
      appProviders.proofWarningRequired =
        source === "wallet" && !isLocalProverServerUrl(proverServerUrl);
    }
    options.onProofProviderStatusChange?.({
      source,
      proverServerUrl,
      warningRequired: source === "wallet" && !isLocalProverServerUrl(proverServerUrl),
    });
  };

  const walletProvingProviderFactory = async () =>
    currentApi.getProvingProvider(keyMaterialProvider);
  const configuredProofProvider = CONFIGURED_PROVER_SERVER_URL
    ? httpClientProvingProvider(CONFIGURED_PROVER_SERVER_URL, zkConfigProvider)
    : null;

  emitProofProviderStatus(
    configuredProofProvider ? "configured_env" : "wallet",
    configuredProofProvider ? CONFIGURED_PROVER_SERVER_URL : config.proverServerUri,
  );

  const provingProvider = {
    check: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
    ): Promise<(bigint | undefined)[]> => {
      if (configuredProofProvider) {
        try {
          return await configuredProofProvider.check(serializedPreimage, keyLocation);
        } catch (error) {
          console.warn("[providers] configured proof server check failed, falling back to wallet prover", error);
        }
      }
      emitProofProviderStatus("wallet", config.proverServerUri);
      return withWalletRetry(async () => {
        const freshProvider = await walletProvingProviderFactory();
        return freshProvider.check(serializedPreimage, keyLocation);
      });
    },
    prove: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> => {
      if (configuredProofProvider) {
        try {
          return await configuredProofProvider.prove(
            serializedPreimage,
            keyLocation,
            overwriteBindingInput,
          );
        } catch (error) {
          console.warn("[providers] configured proof server prove failed, falling back to wallet prover", error);
        }
      }
      emitProofProviderStatus("wallet", config.proverServerUri);
      return withWalletRetry(async () => {
        const freshProvider = await walletProvingProviderFactory();
        return freshProvider.prove(
          serializedPreimage,
          keyLocation,
          overwriteBindingInput,
        );
      });
    },
  };

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
    getEncryptionPublicKey: () =>
      shielded.shieldedEncryptionPublicKey as never,
    async balanceTx(tx) {
      const serialized = toHex(tx.serialize());
      console.debug("[providers] balanceTx: calling connectedApi.balanceUnsealedTransaction", {
        txHexLength: serialized.length,
      });
      const startedAt = Date.now();
      let result;
      try {
        result = await withWalletRetry((connectedApi) =>
          connectedApi.balanceUnsealedTransaction(serialized, {
            payFees: true,
          }),
        );
      } catch (error) {
        logRawWalletError("balanceTx: connectedApi.balanceUnsealedTransaction", error, {
          durationMs: Date.now() - startedAt,
          txHexLength: serialized.length,
        });
        throw error;
      }
      console.debug("[providers] balanceTx: balanceUnsealedTransaction resolved", {
        durationMs: Date.now() - startedAt,
        resultTxHexLength: result.tx?.length,
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
      const submitStartedAt = Date.now();
      const serialized = toHex(tx.serialize());
      console.debug("[providers] submitTx: calling connectedApi.submitTransaction", {
        txHexLength: serialized.length,
      });
      let submittedId;
      try {
        submittedId = await withWalletRetry(async (connectedApi) => {
          const submitted = await connectedApi.submitTransaction(serialized);
          return submittedTransactionId(submitted);
        });
      } catch (error) {
        logRawWalletError("submitTx: connectedApi.submitTransaction", error, {
          durationMs: Date.now() - submitStartedAt,
          txHexLength: serialized.length,
        });
        throw error;
      }
      console.debug("[providers] submitTx: submitTransaction resolved", {
        durationMs: Date.now() - submitStartedAt,
        submittedId,
      });
      const identifier =
        transactionIdentifier(tx) ||
        (await resolveTransactionIdentifierFromHash(indexerUri, submittedId)) ||
        submittedId;
      if (!identifier) {
        throw new Error(
          "Transaction submitted, but no transaction identifier was returned by the wallet connector.",
        );
      }
      return identifier;
    },
  };

  const storageMode = options.storageMode || "app_local";
  const privateStateProvider =
    storageMode === "sdk_level"
      ? levelPrivateStateProvider({
          accountId,
          privateStoragePasswordProvider: () =>
            getTemporaryPrivateStatePassword(accountId),
        })
      : createAppLocalPrivateStateProvider(accountId);

  appProviders = {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(
      indexerUri,
      indexerWsUri,
      WebSocket as never,
    ),
    zkConfigProvider,
    proofProvider: createProofProvider(provingProvider as never),
    circuitProvingProvider: provingProvider as ProvingProvider,
    walletProvider,
    midnightProvider,
    connectedAPI: connectedApiProxy,
    networkId: config.networkId,
    indexerUrl: indexerUri,
    indexerWsUrl: indexerWsUri,
    indexerSource,
    nodeUrl: config.substrateNodeUri,
    proverServerUrl: config.proverServerUri,
    configuredProverServerUrl: CONFIGURED_PROVER_SERVER_URL || undefined,
    proofProviderSource: (configuredProofProvider ? "configured_env" : "wallet") as
      | "configured_env"
      | "wallet",
    proofWarningRequired:
      !configuredProofProvider && !isLocalProverServerUrl(config.proverServerUri),
    shieldedAddress: shielded.shieldedAddress,
    shieldedCoinPublicKeyHex,
    unshieldedAddress: unshielded.unshieldedAddress,
    zkArtifactsBaseUrl: managedContractUrl,
  };
  return appProviders;
}
