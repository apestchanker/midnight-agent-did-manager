import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import {
  Bytes32Descriptor,
  CompactTypeVector,
  CompactTypeUnsignedInteger,
  persistentHash,
} from "@midnight-ntwrk/compact-runtime";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { AppProviders } from "../../lib/providers";
import { requestWalletPermissionsIfSupported } from "../../lib/wallet-permissions";
import { fromHex, toHex } from "../../lib/wallet-bridge";
import {
  createWalletDidRequest,
  getPersistedDidState,
  syncWalletIssuedDid as syncWalletIssuedDidStorage,
  syncWalletRevokedDid as syncWalletRevokedDidStorage,
  syncWalletUpdatedDid as syncWalletUpdatedDidStorage,
} from "../utils/serviceApi";
import type {
  DidRecord,
  DeployResult,
  IssueDidInput,
  RegistryAccess,
  RegistrySummary,
  RevokeDidInput,
  UpdateDidInput,
} from "../types/did";

const DEPLOY_KEY = "did-registry:last-deploy:v6";
const COMPILE_KEY = "did-registry:last-compile:v4";
const DID_CACHE_PREFIX = "did-registry:request-cache:v1";
const OWNER_PRIVATE_STATE_ID = "issuer-owner-state:v1";
const APP_VERSION = (import.meta.env.VITE_APP_VERSION || "0.2.2").trim() || "0.2.2";
const CONTRACT_VERSION = "0.2.2";
const MANAGED_CONTRACT_BASE_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";
const ISSUER_PUBLIC_KEY_PREFIX = new TextEncoder().encode("midnight:did:issuer:v1");
const UINT64_MAX = (1n << 64n) - 1n;
const Uint64Descriptor = new CompactTypeUnsignedInteger(UINT64_MAX, 8);
const INITIAL_ISSUER_NONCE = 1n;
const OWNER_VAULT_KIND = "midnight-did-owner-vault-backup";
const OWNER_VAULT_VERSION = "v1";
const OWNER_VAULT_PBKDF2_ITERATIONS = 600_000;
const OWNER_VAULT_SALT_BYTES = 16;
const OWNER_VAULT_IV_BYTES = 12;

type DidRegistryPrivateState = {
  issuerSecret: Uint8Array;
  createdAt: string;
  vaultVersion: string;
  contractVersion: string;
  appVersion: string;
  networkId: string;
  custodianWalletAddress: string;
  issuerPublicKeyHex: string;
};

type SerializedOwnerPrivateState = Omit<DidRegistryPrivateState, "issuerSecret"> & {
  issuerSecretHex: string;
};

type OwnerVaultBackupPayload = {
  kind: typeof OWNER_VAULT_KIND;
  version: typeof OWNER_VAULT_VERSION;
  contractAddress: string;
  networkId: string;
  exportedAt: string;
  privateState: SerializedOwnerPrivateState;
};

type OwnerVaultBackupEnvelope = {
  kind: typeof OWNER_VAULT_KIND;
  version: typeof OWNER_VAULT_VERSION;
  contractAddress: string;
  networkId: string;
  exportedAt: string;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
};

export type OwnerVaultStatus = {
  hasLocalVault: boolean;
  contractAddress: string;
  createdAt?: string;
  custodianWalletAddress?: string;
  localIssuerPublicKeyHex?: string;
  onChainIssuerPublicKeyHex?: string;
  matchesOnChain: boolean | null;
};

type SavedCompileArtifact = {
  managedPath: string;
  checkedAt: string;
  networkId: string;
};

type SavedDeployment = DeployResult & {
  networkId: string;
  deployedAt: string;
};

type CachedDidMetadata = {
  contractAddress: string;
  agentAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure?: "disclosed" | "undisclosed";
  didDocument?: string;
  createdAt: string;
  updatedAt?: string;
  issuedAt?: string;
  revokedAt?: string;
  txHash?: string;
  txId?: string;
  requestCommitmentHex?: string;
  proofCommitmentHex?: string;
  didCommitmentHex?: string;
  documentHashHex?: string;
  revocationCommitmentHex?: string;
};

type ManagedContractModule = {
  Contract: new (...args: never[]) => unknown;
  ledger: (data: unknown) => Record<string, unknown>;
};

type DeployTransactionMetadata = {
  deployTxData?: {
    public?: {
      txHash?: string;
      txId?: string;
    };
  };
};

export interface CompileResult {
  success: boolean;
  message: string;
}

function cacheKey(contractAddress: string, agentAddress: string): string {
  return `${DID_CACHE_PREFIX}:${contractAddress}:${agentAddress.toLowerCase()}`;
}

function saveCompileArtifact(data: SavedCompileArtifact): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPILE_KEY, JSON.stringify(data));
}

function saveDeployment(result: DeployResult, networkId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DEPLOY_KEY,
    JSON.stringify({
      ...result,
      networkId,
      deployedAt: result.deployedAt || new Date().toISOString(),
    } satisfies SavedDeployment),
  );
}

function saveDidMetadata(metadata: CachedDidMetadata): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(metadata.contractAddress, metadata.agentAddress),
    JSON.stringify(metadata),
  );
}

function getDidMetadata(
  contractAddress: string,
  agentAddress: string,
): CachedDidMetadata | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(cacheKey(contractAddress, agentAddress));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedDidMetadata;
  } catch {
    return null;
  }
}

function readSavedJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toRecordHex(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Uint8Array) return toHex(value);
  if (Array.isArray(value)) return toHex(new Uint8Array(value));
  if (typeof value === "string") return value.replace(/^0x/, "");
  if (
    typeof value === "object" &&
    value !== null &&
    "serialize" in value &&
    typeof (value as { serialize: () => Uint8Array }).serialize === "function"
  ) {
    return toHex((value as { serialize: () => Uint8Array }).serialize());
  }

  return undefined;
}

function bytesEqualHex(value: unknown, targetHex: string): boolean {
  const hex = toRecordHex(value);
  return !!hex && hex.toLowerCase() === targetHex.toLowerCase();
}

function mapLookupByHexKey(
  value: unknown,
  keyHex: string,
): unknown | undefined {
  const keyBytes = fromHex(keyHex);

  if (
    value &&
    typeof value === "object" &&
    "member" in value &&
    "lookup" in value &&
    typeof (value as { member: (key: Uint8Array) => boolean }).member ===
      "function" &&
    typeof (value as { lookup: (key: Uint8Array) => unknown }).lookup ===
      "function"
  ) {
    const compactMap = value as {
      member: (key: Uint8Array) => boolean;
      lookup: (key: Uint8Array) => unknown;
    };
    if (!compactMap.member(keyBytes)) return undefined;
    return compactMap.lookup(keyBytes);
  }

  if (
    value &&
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof (value as Iterable<[unknown, unknown]>)[Symbol.iterator] === "function"
  ) {
    for (const [entryKey, entryValue] of value as Iterable<[unknown, unknown]>) {
      if (bytesEqualHex(entryKey, keyHex)) {
        return entryValue;
      }
    }
  }

  return undefined;
}

function bigintishToNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function statusCodeToDidStatus(statusCode: number): DidRecord["status"] {
  switch (statusCode) {
    case 1:
      return "pending_issuance";
    case 2:
      return "active";
    case 3:
      return "revoked";
    case 4:
      return "pending_update";
    case 5:
      return "pending_revocation";
    default:
      return "pending_issuance";
  }
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

async function createAgentKey(agentAddress: string): Promise<Uint8Array> {
  return sha256Bytes(agentAddress.trim().toLowerCase());
}

function padBytes(value: Uint8Array, length: number): Uint8Array {
  const output = new Uint8Array(length);
  output.set(value.slice(0, length));
  return output;
}

function deriveIssuerNonceHash(nonce: bigint): Uint8Array {
  return persistentHash(Uint64Descriptor, nonce);
}

function deriveIssuerPublicKey(secret: Uint8Array, nonce: bigint): Uint8Array {
  return persistentHash(
    new CompactTypeVector(3, Bytes32Descriptor),
    [padBytes(ISSUER_PUBLIC_KEY_PREFIX, 32), secret, deriveIssuerNonceHash(nonce)],
  );
}

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  window.crypto.getRandomValues(output);
  return output;
}

function createOwnerPrivateState(
  providers: AppProviders,
  issuerSecret: Uint8Array,
): DidRegistryPrivateState {
  const issuerPublicKey = deriveIssuerPublicKey(issuerSecret, INITIAL_ISSUER_NONCE);
  return {
    issuerSecret,
    createdAt: new Date().toISOString(),
    vaultVersion: OWNER_VAULT_VERSION,
    contractVersion: CONTRACT_VERSION,
    appVersion: APP_VERSION,
    networkId: providers.networkId,
    custodianWalletAddress: providers.unshieldedAddress,
    issuerPublicKeyHex: toHex(issuerPublicKey),
  };
}

function createRandomOwnerPrivateState(
  providers: AppProviders,
): DidRegistryPrivateState {
  return createOwnerPrivateState(providers, randomBytes(32));
}

function serializeOwnerPrivateState(
  privateState: DidRegistryPrivateState,
): SerializedOwnerPrivateState {
  return {
    ...privateState,
    issuerSecretHex: toHex(privateState.issuerSecret),
  };
}

function deserializeOwnerPrivateState(
  value: SerializedOwnerPrivateState,
): DidRegistryPrivateState {
  return {
    ...value,
    issuerSecret: fromHex(value.issuerSecretHex),
  };
}

function requireBackupPassword(password: string): string {
  const normalized = password.trim();
  if (normalized.length < 10) {
    throw new Error("Vault backup password must be at least 10 characters long.");
  }
  return normalized;
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toWebCryptoBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function deriveVaultWrappingKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toWebCryptoBuffer(salt),
      iterations: OWNER_VAULT_PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptOwnerVaultBackup(
  payload: OwnerVaultBackupPayload,
  password: string,
): Promise<OwnerVaultBackupEnvelope> {
  const salt = randomBytes(OWNER_VAULT_SALT_BYTES);
  const iv = randomBytes(OWNER_VAULT_IV_BYTES);
  const key = await deriveVaultWrappingKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toWebCryptoBuffer(iv) },
      key,
      toWebCryptoBuffer(plaintext),
    ),
  );

  return {
    kind: OWNER_VAULT_KIND,
    version: OWNER_VAULT_VERSION,
    contractAddress: payload.contractAddress,
    networkId: payload.networkId,
    exportedAt: payload.exportedAt,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: OWNER_VAULT_PBKDF2_ITERATIONS,
    saltBase64: toBase64(salt),
    ivBase64: toBase64(iv),
    ciphertextBase64: toBase64(ciphertext),
  };
}

async function decryptOwnerVaultBackup(
  serializedBackup: string,
  password: string,
): Promise<OwnerVaultBackupPayload> {
  let envelope: OwnerVaultBackupEnvelope;
  try {
    envelope = JSON.parse(serializedBackup) as OwnerVaultBackupEnvelope;
  } catch {
    throw new Error("Vault backup is not valid JSON.");
  }

  if (
    envelope.kind !== OWNER_VAULT_KIND ||
    envelope.version !== OWNER_VAULT_VERSION
  ) {
    throw new Error("Unsupported owner vault backup format.");
  }

  const key = await deriveVaultWrappingKey(
    password,
    fromBase64(envelope.saltBase64),
  );

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toWebCryptoBuffer(fromBase64(envelope.ivBase64)) },
        key,
        toWebCryptoBuffer(fromBase64(envelope.ciphertextBase64)),
      ),
    );
  } catch {
    throw new Error("Failed to decrypt vault backup. Check the backup password.");
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as OwnerVaultBackupPayload;
  } catch {
    throw new Error("Vault backup payload is corrupted or incomplete.");
  }
}

function isValidPrivateState(value: unknown): value is DidRegistryPrivateState {
  return !!(
    value &&
    typeof value === "object" &&
    "issuerSecret" in value &&
    (value as { issuerSecret: unknown }).issuerSecret instanceof Uint8Array &&
    (value as { issuerSecret: Uint8Array }).issuerSecret.length === 32
  );
}

async function getOnChainIssuerPublicKeyHex(
  providers: AppProviders,
  contractAddress: string,
): Promise<string | undefined> {
  const { module } = await getContractRuntime();
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return undefined;
  const ledgerState = module.ledger((state as { data: unknown }).data);
  return toRecordHex(ledgerState.issuer_service);
}

async function getOnChainIssuerNonce(
  providers: AppProviders,
  contractAddress: string,
): Promise<bigint | undefined> {
  const { module } = await getContractRuntime();
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return undefined;
  const ledgerState = module.ledger((state as { data: unknown }).data);
  return typeof ledgerState.issuer_nonce === "bigint" ? ledgerState.issuer_nonce : undefined;
}

async function assertOwnerPrivateStateMatchesContract(
  providers: AppProviders,
  contractAddress: string,
  privateState: DidRegistryPrivateState,
): Promise<void> {
  const onChainIssuerPublicKeyHex = await getOnChainIssuerPublicKeyHex(
    providers,
    contractAddress,
  );
  if (!onChainIssuerPublicKeyHex) {
    throw new Error("Could not read the issuer authorization key from the contract state.");
  }
  const onChainIssuerNonce = await getOnChainIssuerNonce(providers, contractAddress);
  if (onChainIssuerNonce == null) {
    throw new Error("Could not read the issuer authorization nonce from the contract state.");
  }

  const localIssuerPublicKeyHex = toHex(
    deriveIssuerPublicKey(privateState.issuerSecret, onChainIssuerNonce),
  );

  if (localIssuerPublicKeyHex.toLowerCase() !== onChainIssuerPublicKeyHex.toLowerCase()) {
    throw new Error(
      "The local owner vault does not match this contract's on-chain issuer authorization key. Restore the correct backup for this registry.",
    );
  }
}

async function ensureOwnerPrivateState(
  providers: AppProviders,
  contractAddress: string,
): Promise<DidRegistryPrivateState> {
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(
    OWNER_PRIVATE_STATE_ID,
  );
  if (isValidPrivateState(existing)) {
    await assertOwnerPrivateStateMatchesContract(providers, contractAddress, existing);
    return existing;
  }

  throw new Error(
    "Owner vault is missing from Midnight private state for this contract. Restore a vault backup before issuing, updating, or revoking DIDs.",
  );
}

function createWitnesses() {
  return {
    issuerSecret: (context: { privateState: unknown }) => {
      if (!isValidPrivateState(context.privateState)) {
        throw new Error(
          "Owner witness secret is missing from Midnight private state for this contract.",
        );
      }
      return [context.privateState, context.privateState.issuerSecret] as [
        DidRegistryPrivateState,
        Uint8Array,
      ];
    },
  };
}

export async function getOwnerVaultStatus(
  providers: AppProviders,
  contractAddress: string,
): Promise<OwnerVaultStatus> {
  if (!contractAddress.trim()) {
    return {
      hasLocalVault: false,
      contractAddress,
      matchesOnChain: null,
    };
  }

  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(OWNER_PRIVATE_STATE_ID);
  const onChainIssuerPublicKeyHex = await getOnChainIssuerPublicKeyHex(
    providers,
    contractAddress,
  );
  const onChainIssuerNonce = await getOnChainIssuerNonce(providers, contractAddress);

  if (!isValidPrivateState(existing)) {
    return {
      hasLocalVault: false,
      contractAddress,
      onChainIssuerPublicKeyHex,
      matchesOnChain: null,
    };
  }

  const localIssuerPublicKeyHex = toHex(
    deriveIssuerPublicKey(
      existing.issuerSecret,
      onChainIssuerNonce ?? INITIAL_ISSUER_NONCE,
    ),
  );

  return {
    hasLocalVault: true,
    contractAddress,
    createdAt:
      ("createdAt" in existing && typeof existing.createdAt === "string"
        ? existing.createdAt
        : undefined) ||
      ("derivedAt" in (existing as Record<string, unknown>) &&
      typeof (existing as { derivedAt?: string }).derivedAt === "string"
        ? (existing as { derivedAt?: string }).derivedAt
        : undefined),
    custodianWalletAddress:
      "custodianWalletAddress" in existing &&
      typeof existing.custodianWalletAddress === "string"
        ? existing.custodianWalletAddress
        : undefined,
    localIssuerPublicKeyHex,
    onChainIssuerPublicKeyHex,
    matchesOnChain: onChainIssuerPublicKeyHex
      ? localIssuerPublicKeyHex.toLowerCase() === onChainIssuerPublicKeyHex.toLowerCase()
      : null,
  };
}

export async function exportOwnerVaultBackup(
  providers: AppProviders,
  contractAddress: string,
  backupPassword: string,
): Promise<string> {
  const privateState = await ensureOwnerPrivateState(providers, contractAddress);
  const payload: OwnerVaultBackupPayload = {
    kind: OWNER_VAULT_KIND,
    version: OWNER_VAULT_VERSION,
    contractAddress,
    networkId: providers.networkId,
    exportedAt: new Date().toISOString(),
    privateState: serializeOwnerPrivateState(privateState),
  };

  const encrypted = await encryptOwnerVaultBackup(
    payload,
    requireBackupPassword(backupPassword),
  );
  return JSON.stringify(encrypted, null, 2);
}

export async function restoreOwnerVaultBackup(
  providers: AppProviders,
  contractAddress: string,
  serializedBackup: string,
  backupPassword: string,
): Promise<OwnerVaultStatus> {
  const payload = await decryptOwnerVaultBackup(
    serializedBackup,
    requireBackupPassword(backupPassword),
  );

  if (payload.contractAddress.trim() !== contractAddress.trim()) {
    throw new Error(
      `This backup belongs to ${payload.contractAddress}, not ${contractAddress}.`,
    );
  }

  if (payload.networkId !== providers.networkId) {
    throw new Error(
      `This backup targets network ${payload.networkId}, but the connected wallet is on ${providers.networkId}.`,
    );
  }

  const privateState = deserializeOwnerPrivateState(payload.privateState);
  if (!isValidPrivateState(privateState)) {
    throw new Error("The owner vault backup payload is invalid.");
  }

  await assertOwnerPrivateStateMatchesContract(
    providers,
    contractAddress,
    privateState,
  );

  providers.privateStateProvider.setContractAddress(contractAddress as never);
  await providers.privateStateProvider.set(OWNER_PRIVATE_STATE_ID, privateState);
  return getOwnerVaultStatus(providers, contractAddress);
}

async function createRequestCommitment(input: {
  contractAddress: string;
  agentAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      contractAddress: input.contractAddress.trim(),
      agentAddress: input.agentAddress.trim().toLowerCase(),
      agentName: (input.agentName || "").trim(),
      organization: (input.organization || "").trim(),
      organizationDisclosure: input.organizationDisclosure,
      didDocument: input.didDocument.trim(),
    }),
  );
}

async function createProofCommitment(input: {
  networkId: string;
  contractAddress: string;
  agentAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    [
      input.networkId,
      input.contractAddress.trim(),
      input.agentAddress.trim().toLowerCase(),
      (input.agentName || "").trim(),
      (input.organization || "").trim(),
      input.organizationDisclosure,
      input.didDocument.trim(),
    ].join(":"),
  );
}

function encodeFixedBytes(value: string, length: number): Uint8Array {
  const bytes = new TextEncoder().encode(value.trim());
  const output = new Uint8Array(length);
  output.set(bytes.slice(0, length));
  return output;
}

function decodeFixedBytes(value: unknown): string | undefined {
  const bytes =
    value instanceof Uint8Array
      ? value
      : Array.isArray(value)
        ? new Uint8Array(value)
        : null;
  if (!bytes) return undefined;
  const end = bytes.findIndex((item) => item === 0);
  const sliced = end === -1 ? bytes : bytes.slice(0, end);
  const decoded = new TextDecoder().decode(sliced).trim();
  return decoded || undefined;
}

function disclosureFlag(
  disclosure: "disclosed" | "undisclosed" | undefined,
): bigint {
  return disclosure === "disclosed" ? 1n : 0n;
}

function disclosureFromValue(value: unknown): "disclosed" | "undisclosed" {
  return bigintishToNumber(value) === 1 ? "disclosed" : "undisclosed";
}

async function createDidIdentifier(
  networkId: string,
  contractAddress: string,
  agentKeyHex: string,
): Promise<string> {
  return `did:midnight:${networkId}:${contractAddress}:${agentKeyHex}`;
}

async function createDidCommitment(input: {
  did: string;
  contractAddress: string;
  agentAddress: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      did: input.did,
      contractAddress: input.contractAddress.trim(),
      agentAddress: input.agentAddress.trim().toLowerCase(),
    }),
  );
}

async function createDocumentCommitment(didDocument: string): Promise<Uint8Array> {
  return sha256Bytes(didDocument.trim());
}

async function createLifecycleProofCommitment(input: {
  action: "issue_did" | "update_did";
  networkId: string;
  contractAddress: string;
  agentAddress: string;
  did: string;
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      action: input.action,
      networkId: input.networkId,
      contractAddress: input.contractAddress.trim(),
      agentAddress: input.agentAddress.trim().toLowerCase(),
      did: input.did,
      didDocument: input.didDocument.trim(),
    }),
  );
}

async function createRevocationCommitment(input: {
  networkId: string;
  contractAddress: string;
  agentAddress: string;
  did: string;
  reason: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      action: "revoke_did",
      networkId: input.networkId,
      contractAddress: input.contractAddress.trim(),
      agentAddress: input.agentAddress.trim().toLowerCase(),
      did: input.did,
      reason: input.reason.trim(),
    }),
  );
}

function mergeDidMetadata(
  contractAddress: string,
  agentAddress: string,
  patch: Partial<CachedDidMetadata>,
): CachedDidMetadata {
  const existing = getDidMetadata(contractAddress, agentAddress);
  const merged: CachedDidMetadata = {
    contractAddress,
    agentAddress,
    createdAt: existing?.createdAt || new Date().toISOString(),
    ...existing,
    ...patch,
  };
  saveDidMetadata(merged);
  return merged;
}

async function loadManagedContractModule(): Promise<ManagedContractModule> {
  try {
    return (await import(
      "../generated/didRegistryContract.runtime.js"
    )) as ManagedContractModule;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown import failure";
    throw new Error(
      `Managed contract runtime is missing under src/generated/didRegistryContract.runtime.js or could not be bundled by Vite. Run \`npm run compile-contract\`. Details: ${message}`,
    );
  }
}

async function primeWalletSession(providers: AppProviders): Promise<void> {
  await requestWalletPermissionsIfSupported(providers.connectedAPI);
  await providers.connectedAPI.getConfiguration();
  await providers.connectedAPI.getShieldedAddresses();
  await providers.connectedAPI.getUnshieldedAddress();
}

async function getContractRuntime() {
  const module = await loadManagedContractModule();
  const contractDefinition = CompactCompiledContract.make(
    "did-registry",
    module.Contract as never,
  ) as never;
  const contractWithWitnesses = CompactCompiledContract.withWitnesses(
    contractDefinition,
    createWitnesses() as never,
  ) as never;
  const compiledContract = CompactCompiledContract.withCompiledFileAssets(
    contractWithWitnesses,
    MANAGED_CONTRACT_BASE_PATH as never,
  ) as never;

  return { module, compiledContract };
}

function extractContractAddress(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const fromSelf = extractContractAddress(objectValue.contractAddress);
    if (fromSelf) return fromSelf;
    const fromDeployTx = extractContractAddress(objectValue.deployTxData);
    if (fromDeployTx) return fromDeployTx;
    const fromPublic = extractContractAddress(objectValue.public);
    if (fromPublic) return fromPublic;
  }

  return "";
}

function countStatuses(mapValue: unknown, targetStatus: number): number {
  if (
    !mapValue ||
    typeof mapValue !== "object" ||
    !(Symbol.iterator in mapValue) ||
    typeof (mapValue as Iterable<[unknown, unknown]>)[Symbol.iterator] !==
      "function"
  ) {
    return 0;
  }
  let count = 0;
  for (const [, value] of mapValue as Iterable<[unknown, unknown]>) {
    if (bigintishToNumber(value) === targetStatus) {
      count += 1;
    }
  }
  return count;
}

export function getSavedContractAddress(): string {
  return getSavedDeployment()?.contractAddress || "";
}

export function getSavedDeployment(): SavedDeployment | null {
  return readSavedJson<SavedDeployment>(DEPLOY_KEY);
}

export function getSavedCompileArtifact(): SavedCompileArtifact | null {
  return readSavedJson<SavedCompileArtifact>(COMPILE_KEY);
}

export async function compileDidRegistry(
  providers: AppProviders,
): Promise<CompileResult> {
  await loadManagedContractModule();

  saveCompileArtifact({
    managedPath: MANAGED_CONTRACT_BASE_PATH,
    checkedAt: new Date().toISOString(),
    networkId: providers.networkId,
  });

  return {
    success: true,
    message: `Managed Compact assets loaded from ${MANAGED_CONTRACT_BASE_PATH}. The app is ready to deploy on ${providers.networkId}.`,
  };
}

export async function deployDidRegistry(
  providers: AppProviders,
): Promise<DeployResult> {
  const compileData = getSavedCompileArtifact();
  if (!compileData) {
    throw new Error(
      "Managed contract assets have not been validated yet. Load the compiled contract first.",
    );
  }

  await primeWalletSession(providers);
  const ownerPrivateState = createRandomOwnerPrivateState(providers);
  const ownerPublicKey = deriveIssuerPublicKey(
    ownerPrivateState.issuerSecret,
    INITIAL_ISSUER_NONCE,
  );
  const { compiledContract } = await getContractRuntime();
  const deployed = await deployContract(providers as never, {
    compiledContract,
    args: [ownerPublicKey],
    privateStateId: OWNER_PRIVATE_STATE_ID,
    initialPrivateState: ownerPrivateState,
  });

  const contractAddress = extractContractAddress(deployed);
  if (!contractAddress) {
    throw new Error(
      "Deployment succeeded but the contract address could not be derived from the Midnight SDK response.",
    );
  }

  providers.privateStateProvider.setContractAddress(contractAddress as never);
  await providers.privateStateProvider.set(OWNER_PRIVATE_STATE_ID, ownerPrivateState);

  const result: DeployResult = {
    contractAddress,
    txHash: String(
      (deployed as DeployTransactionMetadata).deployTxData?.public?.txHash || "",
    ),
    txId: String(
      (deployed as DeployTransactionMetadata).deployTxData?.public?.txId || "",
    ),
    txStatus: "confirmed",
    mode: "onchain",
    deployedAt: new Date().toISOString(),
    networkId: providers.networkId,
    message:
      "Contract deployed to Midnight. A random owner secret was generated, only the derived public authorization key was stored on-chain, and the owner vault was saved to Midnight private state. Export a backup before relying on this registry.",
  };

  saveDeployment(result, providers.networkId);
  return result;
}

export async function requestDid(
  providers: AppProviders,
  input: {
    contractAddress: string;
    requesterWalletAddress: string;
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  },
): Promise<DidRecord> {
  const { compiledContract } = await getContractRuntime();
  const contract = await findDeployedContract(providers as never, {
    compiledContract,
    contractAddress: input.contractAddress as never,
    privateStateId: OWNER_PRIVATE_STATE_ID,
  });

  const agentKey = await createAgentKey(input.agentAddress);
  const requestCommitment = await createRequestCommitment(input);
  const proofCommitment = await createProofCommitment({
    ...input,
    networkId: providers.networkId,
  });
  const organizationLabel = encodeFixedBytes(input.organization || "", 64);
  const organizationDisclosure = disclosureFlag(input.organizationDisclosure);

  const tx = await (contract.callTx.request_did as (
    agentKeyArg: Uint8Array,
    requestCommitmentArg: Uint8Array,
    proofCommitmentArg: Uint8Array,
    organizationLabelArg: Uint8Array,
    organizationDisclosureArg: bigint,
  ) => Promise<{ public: { txHash: string; txId?: string } }>)(agentKey, requestCommitment, proofCommitment, organizationLabel, organizationDisclosure);

  const now = new Date().toISOString();
  const requestedDid = await createDidIdentifier(
    providers.networkId,
    input.contractAddress,
    toHex(agentKey),
  );
  const record: DidRecord = {
    agentAddress: input.agentAddress,
    agentName: input.agentName,
    organization:
      input.organizationDisclosure === "disclosed"
        ? input.organization
        : undefined,
    organizationDisclosure: input.organizationDisclosure,
    didDocument: input.didDocument.trim(),
    agentKeyHex: toHex(agentKey),
    requestCommitmentHex: toHex(requestCommitment),
    proofCommitmentHex: toHex(proofCommitment),
    status: "pending_issuance",
    proofStatus: "verified",
    txStatus: "confirmed",
    createdAt: now,
    updatedAt: now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    mode: "onchain",
  };

  mergeDidMetadata(input.contractAddress, input.agentAddress, {
    agentName: input.agentName,
    organization:
      input.organizationDisclosure === "disclosed"
        ? input.organization
        : undefined,
    organizationDisclosure: input.organizationDisclosure,
    didDocument: input.didDocument.trim(),
    createdAt: now,
    updatedAt: now,
    txHash: record.txHash,
    txId: record.txId,
    requestCommitmentHex: record.requestCommitmentHex,
    proofCommitmentHex: record.proofCommitmentHex,
  });

  try {
    await createWalletDidRequest({
      walletAddress: input.requesterWalletAddress,
      subjectWalletAddress: input.agentAddress,
      contractAddress: input.contractAddress,
      networkId: providers.networkId,
      organizationName: input.organization,
      organizationDisclosure: input.organizationDisclosure,
      requestPayload: {
        agentName: input.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      requestedDid,
      onchainRequestTxId: record.txId,
      onchainRequestTxHash: record.txHash,
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID request was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return record;
}

export async function issueDid(
  providers: AppProviders,
  input: IssueDidInput,
): Promise<DidRecord> {
  const ownerPrivateState = await ensureOwnerPrivateState(
    providers,
    input.contractAddress,
  );
  const { compiledContract } = await getContractRuntime();
  const contract = await findDeployedContract(providers as never, {
    compiledContract,
    contractAddress: input.contractAddress as never,
    privateStateId: OWNER_PRIVATE_STATE_ID,
    initialPrivateState: ownerPrivateState,
  });

  const agentKey = await createAgentKey(input.agentAddress);
  const agentKeyHex = toHex(agentKey);
  const did = await createDidIdentifier(
    providers.networkId,
    input.contractAddress,
    agentKeyHex,
  );
  const didCommitment = await createDidCommitment({
    did,
    contractAddress: input.contractAddress,
    agentAddress: input.agentAddress,
  });
  const documentCommitment = await createDocumentCommitment(input.didDocument);
  const proofCommitment = await createLifecycleProofCommitment({
    action: "issue_did",
    networkId: providers.networkId,
    contractAddress: input.contractAddress,
    agentAddress: input.agentAddress,
    did,
    didDocument: input.didDocument,
  });
  const existing = getDidMetadata(input.contractAddress, input.agentAddress);
  const organization = existing?.organization;
  const organizationDisclosureValue = existing?.organizationDisclosure || "undisclosed";
  const organizationLabel = encodeFixedBytes(
    organizationDisclosureValue === "disclosed" ? organization || "" : "",
    64,
  );
  const organizationDisclosure = disclosureFlag(organizationDisclosureValue);

  const tx = await (contract.callTx.issue_did as (
    agentKeyArg: Uint8Array,
    didCommitmentArg: Uint8Array,
    documentCommitmentArg: Uint8Array,
    proofCommitmentArg: Uint8Array,
    organizationLabelArg: Uint8Array,
    organizationDisclosureArg: bigint,
  ) => Promise<{ public: { txHash: string; txId?: string } }>)(agentKey, didCommitment, documentCommitment, proofCommitment, organizationLabel, organizationDisclosure);

  const now = new Date().toISOString();
  const cached = mergeDidMetadata(input.contractAddress, input.agentAddress, {
    updatedAt: now,
    issuedAt: now,
    revokedAt: undefined,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    didDocument: input.didDocument.trim(),
    didCommitmentHex: toHex(didCommitment),
    documentHashHex: toHex(documentCommitment),
    proofCommitmentHex: toHex(proofCommitment),
  });

  try {
    await syncWalletIssuedDidStorage({
      issuerWalletAddress: providers.unshieldedAddress,
      subjectWalletAddress: input.agentAddress,
      contractAddress: input.contractAddress,
      networkId: providers.networkId,
      did,
      organizationName: cached.organization,
      organizationDisclosure: cached.organizationDisclosure || "undisclosed",
      requestPayload: {
        agentName: cached.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      didDocument: JSON.parse(input.didDocument),
      didCommitment: toHex(didCommitment),
      documentCommitment: toHex(documentCommitment),
      proofCommitment: toHex(proofCommitment),
      onchainIssueTxId: String(tx.public.txId || ""),
      onchainIssueTxHash: String(tx.public.txHash || ""),
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID issuance was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    agentAddress: input.agentAddress,
    agentName: cached.agentName,
    organization: cached.organization,
    organizationDisclosure: cached.organizationDisclosure,
    didDocument: input.didDocument.trim(),
    agentKeyHex,
    did,
    didHashHex: toHex(didCommitment),
    didCommitmentHex: toHex(didCommitment),
    documentHashHex: toHex(documentCommitment),
    requestCommitmentHex: cached.requestCommitmentHex,
    proofCommitmentHex: toHex(proofCommitment),
    status: "active",
    proofStatus: "verified",
    txStatus: "confirmed",
    createdAt: cached.createdAt,
    updatedAt: now,
    issuedAt: now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    mode: "onchain",
  };
}

export async function updateDid(
  providers: AppProviders,
  input: UpdateDidInput,
): Promise<DidRecord> {
  const ownerPrivateState = await ensureOwnerPrivateState(
    providers,
    input.contractAddress,
  );
  const { compiledContract } = await getContractRuntime();
  const contract = await findDeployedContract(providers as never, {
    compiledContract,
    contractAddress: input.contractAddress as never,
    privateStateId: OWNER_PRIVATE_STATE_ID,
    initialPrivateState: ownerPrivateState,
  });

  const agentKey = await createAgentKey(input.agentAddress);
  const agentKeyHex = toHex(agentKey);
  const did = await createDidIdentifier(
    providers.networkId,
    input.contractAddress,
    agentKeyHex,
  );
  const didCommitment = await createDidCommitment({
    did,
    contractAddress: input.contractAddress,
    agentAddress: input.agentAddress,
  });
  const documentCommitment = await createDocumentCommitment(input.didDocument);
  const proofCommitment = await createLifecycleProofCommitment({
    action: "update_did",
    networkId: providers.networkId,
    contractAddress: input.contractAddress,
    agentAddress: input.agentAddress,
    did,
    didDocument: input.didDocument,
  });
  const existing = getDidMetadata(input.contractAddress, input.agentAddress);
  const organization = existing?.organization;
  const organizationDisclosureValue = existing?.organizationDisclosure || "undisclosed";
  const organizationLabel = encodeFixedBytes(
    organizationDisclosureValue === "disclosed" ? organization || "" : "",
    64,
  );
  const organizationDisclosure = disclosureFlag(organizationDisclosureValue);

  const tx = await (contract.callTx.update_did as (
    agentKeyArg: Uint8Array,
    didCommitmentArg: Uint8Array,
    documentCommitmentArg: Uint8Array,
    proofCommitmentArg: Uint8Array,
    organizationLabelArg: Uint8Array,
    organizationDisclosureArg: bigint,
  ) => Promise<{ public: { txHash: string; txId?: string } }>)(agentKey, didCommitment, documentCommitment, proofCommitment, organizationLabel, organizationDisclosure);

  const now = new Date().toISOString();
  const cached = mergeDidMetadata(input.contractAddress, input.agentAddress, {
    updatedAt: now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    didDocument: input.didDocument.trim(),
    didCommitmentHex: toHex(didCommitment),
    documentHashHex: toHex(documentCommitment),
    proofCommitmentHex: toHex(proofCommitment),
  });

  try {
    await syncWalletUpdatedDidStorage({
      did,
      didDocument: JSON.parse(input.didDocument),
      documentCommitment: toHex(documentCommitment),
      proofCommitment: toHex(proofCommitment),
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID update was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    agentAddress: input.agentAddress,
    agentName: cached.agentName,
    organization: cached.organization,
    organizationDisclosure: cached.organizationDisclosure,
    didDocument: input.didDocument.trim(),
    agentKeyHex,
    did,
    didHashHex: toHex(didCommitment),
    didCommitmentHex: toHex(didCommitment),
    documentHashHex: toHex(documentCommitment),
    requestCommitmentHex: cached.requestCommitmentHex,
    proofCommitmentHex: toHex(proofCommitment),
    revocationCommitmentHex: cached.revocationCommitmentHex,
    status: "active",
    proofStatus: "verified",
    txStatus: "confirmed",
    createdAt: cached.createdAt,
    updatedAt: now,
    issuedAt: cached.issuedAt || now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    mode: "onchain",
  };
}

export async function revokeDid(
  providers: AppProviders,
  input: RevokeDidInput,
): Promise<DidRecord> {
  const ownerPrivateState = await ensureOwnerPrivateState(
    providers,
    input.contractAddress,
  );
  const { compiledContract } = await getContractRuntime();
  const contract = await findDeployedContract(providers as never, {
    compiledContract,
    contractAddress: input.contractAddress as never,
    privateStateId: OWNER_PRIVATE_STATE_ID,
    initialPrivateState: ownerPrivateState,
  });

  const agentKey = await createAgentKey(input.agentAddress);
  const agentKeyHex = toHex(agentKey);
  const did = await createDidIdentifier(
    providers.networkId,
    input.contractAddress,
    agentKeyHex,
  );
  const revocationCommitment = await createRevocationCommitment({
    networkId: providers.networkId,
    contractAddress: input.contractAddress,
    agentAddress: input.agentAddress,
    did,
    reason: input.reason,
  });

  const tx = await (contract.callTx.revoke_did as (
    agentKeyArg: Uint8Array,
    revocationCommitmentArg: Uint8Array,
  ) => Promise<{ public: { txHash: string; txId?: string } }>)(agentKey, revocationCommitment);

  const now = new Date().toISOString();
  const cached = mergeDidMetadata(input.contractAddress, input.agentAddress, {
    updatedAt: now,
    revokedAt: now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    revocationCommitmentHex: toHex(revocationCommitment),
  });

  try {
    await syncWalletRevokedDidStorage({
      did,
      revocationCommitment: toHex(revocationCommitment),
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID revocation was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    agentAddress: input.agentAddress,
    agentName: cached.agentName,
    organization: cached.organization,
    organizationDisclosure: cached.organizationDisclosure,
    didDocument: cached.didDocument,
    agentKeyHex,
    did,
    didHashHex: cached.didCommitmentHex,
    didCommitmentHex: cached.didCommitmentHex,
    documentHashHex: cached.documentHashHex,
    requestCommitmentHex: cached.requestCommitmentHex,
    proofCommitmentHex: cached.proofCommitmentHex,
    revocationCommitmentHex: toHex(revocationCommitment),
    status: "revoked",
    proofStatus: cached.proofCommitmentHex ? "verified" : "not_requested",
    txStatus: "confirmed",
    createdAt: cached.createdAt,
    updatedAt: now,
    issuedAt: cached.issuedAt,
    revokedAt: now,
    txHash: String(tx.public.txHash || ""),
    txId: String(tx.public.txId || ""),
    mode: "onchain",
  };
}

export async function fetchDidRecord(
  providers: AppProviders,
  contractAddress: string,
  agentAddress: string,
): Promise<DidRecord | null> {
  if (!contractAddress.trim() || !agentAddress.trim()) return null;

  const { module } = await getContractRuntime();
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return null;

  const ledgerState = module.ledger((state as { data: unknown }).data);
  const agentKey = await createAgentKey(agentAddress);
  const agentKeyHex = toHex(agentKey);
  const statusCode = bigintishToNumber(
    mapLookupByHexKey(ledgerState.status_by_agent, agentKeyHex),
  );
  if (!statusCode) return null;

  const didCommitmentHex = toRecordHex(
    mapLookupByHexKey(ledgerState.did_commitments, agentKeyHex),
  );
  const documentHashHex = toRecordHex(
    mapLookupByHexKey(ledgerState.document_commitments, agentKeyHex),
  );
  const requestCommitmentHex = toRecordHex(
    mapLookupByHexKey(ledgerState.request_commitments, agentKeyHex),
  );
  const proofCommitmentHex = toRecordHex(
    mapLookupByHexKey(ledgerState.proof_commitments, agentKeyHex),
  );
  const revocationCommitmentHex = toRecordHex(
    mapLookupByHexKey(ledgerState.revocation_commitments, agentKeyHex),
  );
  const organizationLabel = decodeFixedBytes(
    mapLookupByHexKey(ledgerState.organization_labels, agentKeyHex),
  );
  const organizationDisclosure = disclosureFromValue(
    mapLookupByHexKey(ledgerState.organization_disclosures, agentKeyHex),
  );
  const cached = getDidMetadata(contractAddress, agentAddress);
  let persisted: Awaited<ReturnType<typeof getPersistedDidState>> | null = null;
  try {
    persisted = await getPersistedDidState({
      contractAddress,
      walletAddress: agentAddress,
    });
  } catch {
    persisted = null;
  }
  const persistedRequest = persisted?.request || null;
  const persistedRecord = persisted?.record || null;
  const did = didCommitmentHex
    ? await createDidIdentifier(providers.networkId, contractAddress, agentKeyHex)
    : undefined;

  if (!persistedRequest && cached?.requestCommitmentHex) {
    try {
      await createWalletDidRequest({
        walletAddress: agentAddress,
        subjectWalletAddress: agentAddress,
        contractAddress,
        networkId: providers.networkId,
        organizationName: cached.organization,
        organizationDisclosure,
        requestPayload: {
          agentName: cached.agentName || null,
          didDocument: cached.didDocument || null,
        },
        requestedDid: did,
        onchainRequestTxId: cached.txId,
        onchainRequestTxHash: cached.txHash,
      });
    } catch (error) {
      console.warn("[didContract] failed to backfill on-chain request into DB", error);
    }
  }

  return {
    agentAddress,
    agentName:
      (typeof persistedRequest?.request_payload?.agentName === "string"
        ? persistedRequest.request_payload.agentName
        : undefined) || cached?.agentName,
    organization:
      organizationDisclosure === "disclosed"
        ? organizationLabel || persistedRecord?.organization_name || cached?.organization
        : undefined,
    organizationDisclosure,
    didDocument:
      (persistedRecord?.did_document
        ? JSON.stringify(persistedRecord.did_document, null, 2)
        : typeof persistedRequest?.request_payload?.didDocument === "string"
          ? persistedRequest.request_payload.didDocument
          : undefined) || cached?.didDocument,
    agentKeyHex,
    did,
    didHashHex: didCommitmentHex,
    didCommitmentHex,
    documentHashHex: documentHashHex || cached?.documentHashHex,
    requestCommitmentHex:
      requestCommitmentHex || cached?.requestCommitmentHex || undefined,
    proofCommitmentHex:
      proofCommitmentHex || cached?.proofCommitmentHex || undefined,
    revocationCommitmentHex:
      revocationCommitmentHex || cached?.revocationCommitmentHex,
    status: statusCodeToDidStatus(statusCode),
    proofStatus: proofCommitmentHex ? "verified" : "not_requested",
    txStatus: "confirmed",
    createdAt: persistedRequest?.created_at || persistedRecord?.created_at || cached?.createdAt || new Date().toISOString(),
    updatedAt: persistedRecord?.updated_at || persistedRequest?.updated_at || cached?.updatedAt || new Date().toISOString(),
    issuedAt:
      statusCode >= 2
        ? persistedRecord?.issued_at || cached?.issuedAt || new Date().toISOString()
        : undefined,
    revokedAt:
      statusCode === 3
        ? persistedRecord?.revoked_at || cached?.revokedAt || new Date().toISOString()
        : undefined,
    txHash:
      persistedRecord?.status === "active"
        ? persistedRequest?.onchain_issue_tx_hash || cached?.txHash
        : persistedRequest?.onchain_request_tx_hash || cached?.txHash,
    txId:
      persistedRecord?.status === "active"
        ? persistedRequest?.onchain_issue_tx_id || cached?.txId
        : persistedRequest?.onchain_request_tx_id || cached?.txId,
    mode: "onchain",
  };
}

export async function fetchRegistrySummary(
  providers: AppProviders,
  contractAddress: string,
): Promise<RegistrySummary | null> {
  if (!contractAddress.trim()) return null;

  const { module } = await getContractRuntime();
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return null;

  const ledgerState = module.ledger((state as { data: unknown }).data);

  return {
    contractAddress,
    networkId: providers.networkId,
    mode: "onchain",
    totalRequests: bigintishToNumber(ledgerState.total_requests),
    totalActiveDids: bigintishToNumber(ledgerState.total_active_dids),
    totalRevokedDids: countStatuses(ledgerState.status_by_agent, 3),
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function fetchRegistryAccess(
  providers: AppProviders,
  contractAddress: string,
  walletAddress: string,
): Promise<RegistryAccess | null> {
  if (!contractAddress.trim() || !walletAddress.trim()) return null;

  const { module } = await getContractRuntime();
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return null;

  const ledgerState = module.ledger((state as { data: unknown }).data);
  const walletKeyHex = toHex(await createAgentKey(walletAddress));
  const registryAdminKeyHex = toRecordHex(ledgerState.registry_admin);
  const issuerServiceKeyHex = toRecordHex(ledgerState.issuer_service);

  return {
    contractAddress,
    isRegistryAdmin:
      !!registryAdminKeyHex &&
      registryAdminKeyHex.toLowerCase() === walletKeyHex.toLowerCase(),
    isIssuer:
      !!issuerServiceKeyHex &&
      issuerServiceKeyHex.toLowerCase() === walletKeyHex.toLowerCase(),
    registryAdminKeyHex,
    issuerServiceKeyHex,
  };
}
