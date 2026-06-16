import type { DeployResult } from "../../types/did";

export const DEPLOY_KEY = "did-registry:last-deploy:v6";
export const COMPILE_KEY = "did-registry:last-compile:v4";
export const DID_CACHE_PREFIX = "did-registry:request-cache:v2";
export const MANAGED_CONTRACT_BASE_PATH =
  (import.meta.env.VITE_MANAGED_CONTRACT_PATH || "").trim() ||
  "/contracts/managed/did-registry";

export const DID_SUBJECT_NONCE_PREFIX = "didmn:default-slot:v1";
export const DEFAULT_SUBJECT_NONCE = "ba3649522b461286f41043ca6548f1d5dcd2c3e74e1d59fa74102fc1eb1ce531";
export const SLOT_PRIVATE_STATE_ID = "did-slot-state:v2";

export type DidSlotPrivateState = {
  subjectNonce: string;
  createdAt: string;
  networkId: string;
  contractAddress: string;
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
  agentId: string;
  didKeyHex?: string;
  subjectWalletAddress?: string;
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
