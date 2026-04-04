import { CompactTypeUnsignedInteger } from "@midnight-ntwrk/compact-runtime";
import type { DeployResult } from "../../types/did";

export const DEPLOY_KEY = "did-registry:last-deploy:v6";
export const COMPILE_KEY = "did-registry:last-compile:v4";
export const DID_CACHE_PREFIX = "did-registry:request-cache:v1";
export const OWNER_PRIVATE_STATE_ID = "issuer-owner-state:v1";
export const MANAGED_CONTRACT_BASE_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";
export const ISSUER_PUBLIC_KEY_PREFIX = new TextEncoder().encode("midnight:did:issuer:v1");
export const UINT64_MAX = (1n << 64n) - 1n;
export const Uint64Descriptor = new CompactTypeUnsignedInteger(UINT64_MAX, 8);
export const INITIAL_ISSUER_NONCE = 1n;
export const OWNER_VAULT_KIND = "midnight-did-owner-vault-backup";
export const OWNER_VAULT_VERSION = "v1";
export const OWNER_VAULT_PBKDF2_ITERATIONS = 600_000;
export const OWNER_VAULT_SALT_BYTES = 16;
export const OWNER_VAULT_IV_BYTES = 12;

export type DidRegistryPrivateState = {
  issuerSecret: Uint8Array;
  createdAt: string;
  vaultVersion: string;
  contractVersion: string;
  appVersion: string;
  networkId: string;
  custodianWalletAddress: string;
  issuerPublicKeyHex: string;
};

export type SerializedOwnerPrivateState = Omit<DidRegistryPrivateState, "issuerSecret"> & {
  issuerSecretHex: string;
};

export type OwnerVaultBackupPayload = {
  kind: typeof OWNER_VAULT_KIND;
  version: typeof OWNER_VAULT_VERSION;
  contractAddress: string;
  networkId: string;
  exportedAt: string;
  privateState: SerializedOwnerPrivateState;
};

export type OwnerVaultBackupEnvelope = {
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

export type SavedCompileArtifact = {
  managedPath: string;
  checkedAt: string;
  networkId: string;
};

export type SavedDeployment = DeployResult & {
  networkId: string;
  deployedAt: string;
};

export type CachedDidMetadata = {
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

export type ManagedContractModule = {
  Contract: new (...args: never[]) => unknown;
  ledger: (data: unknown) => Record<string, unknown>;
};

export type DeployTransactionMetadata = {
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

