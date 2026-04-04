import {
  Bytes32Descriptor,
  CompactTypeVector,
  persistentHash,
} from "@midnight-ntwrk/compact-runtime";
import {
  INITIAL_ISSUER_NONCE,
  ISSUER_PUBLIC_KEY_PREFIX,
  OWNER_VAULT_IV_BYTES,
  OWNER_VAULT_KIND,
  OWNER_VAULT_PBKDF2_ITERATIONS,
  OWNER_VAULT_SALT_BYTES,
  OWNER_VAULT_VERSION,
  Uint64Descriptor,
  type DidRegistryPrivateState,
  type OwnerVaultBackupEnvelope,
  type OwnerVaultBackupPayload,
  type SerializedOwnerPrivateState,
} from "./types";

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

export async function createAgentKey(agentAddress: string): Promise<Uint8Array> {
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

export function deriveIssuerPublicKey(secret: Uint8Array, nonce: bigint): Uint8Array {
  return persistentHash(
    new CompactTypeVector(3, Bytes32Descriptor),
    [padBytes(ISSUER_PUBLIC_KEY_PREFIX, 32), secret, deriveIssuerNonceHash(nonce)],
  );
}

export function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

export function createRandomOwnerSecret(): Uint8Array {
  return randomBytes(32);
}

export function getInitialIssuerNonce(): bigint {
  return INITIAL_ISSUER_NONCE;
}

export function serializeOwnerPrivateState(
  privateState: DidRegistryPrivateState,
  toHex: (value: Uint8Array) => string,
): SerializedOwnerPrivateState {
  return {
    ...privateState,
    issuerSecretHex: toHex(privateState.issuerSecret),
  };
}

export function deserializeOwnerPrivateState(
  value: SerializedOwnerPrivateState,
  fromHex: (value: string) => Uint8Array,
): DidRegistryPrivateState {
  return {
    ...value,
    issuerSecret: fromHex(value.issuerSecretHex),
  };
}

export function requireBackupPassword(password: string): string {
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
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
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

export async function encryptOwnerVaultBackup(
  payload: OwnerVaultBackupPayload,
  password: string,
): Promise<OwnerVaultBackupEnvelope> {
  const salt = randomBytes(OWNER_VAULT_SALT_BYTES);
  const iv = randomBytes(OWNER_VAULT_IV_BYTES);
  const key = await deriveVaultWrappingKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
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

export async function decryptOwnerVaultBackup(
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
      await crypto.subtle.decrypt(
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

export async function createRequestCommitment(input: {
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

export async function createProofCommitment(input: {
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

export function encodeFixedBytes(value: string, length: number): Uint8Array {
  const bytes = new TextEncoder().encode(value.trim());
  const output = new Uint8Array(length);
  output.set(bytes.slice(0, length));
  return output;
}

export function decodeFixedBytes(value: unknown): string | undefined {
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

export function disclosureFlag(
  disclosure: "disclosed" | "undisclosed" | undefined,
): bigint {
  return disclosure === "disclosed" ? 1n : 0n;
}

export function disclosureFromValue(value: unknown): "disclosed" | "undisclosed" {
  return typeof value === "bigint" ? (value === 1n ? "disclosed" : "undisclosed") : Number(value) === 1 ? "disclosed" : "undisclosed";
}

export async function createDidIdentifier(
  networkId: string,
  contractAddress: string,
  agentKeyHex: string,
): Promise<string> {
  return `did:midnight:${networkId}:${contractAddress}:${agentKeyHex}`;
}

export async function createDidCommitment(input: {
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

export async function createDocumentCommitment(didDocument: string): Promise<Uint8Array> {
  return sha256Bytes(didDocument.trim());
}

export async function createLifecycleProofCommitment(input: {
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

export async function createRevocationCommitment(input: {
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

