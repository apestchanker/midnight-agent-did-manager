export type DeploymentMode = "onchain" | "local-fallback";
export type DidStatus =
  | "pending_issuance"
  | "active"
  | "revoked"
  | "pending_update";
export type ProofStatus = "not_requested" | "generated" | "verified";
export type TxStatus = "draft" | "submitted" | "confirmed" | "failed";

export interface DeployResult {
  contractAddress: string;
  txHash: string;
  txId?: string;
  mode: DeploymentMode;
  message?: string;
  txStatus?: TxStatus;
  deployedAt?: string;
  networkId?: string;
  initializeTxHash?: string;
  initializeTxId?: string;
  ownerDerivation?: {
    scheme: "wallet-signature-sha256-v1" | "random-secret-v1";
    signDomain?: string;
    deploymentSaltHex?: string;
  };
}

export interface RequestDidInput {
  contractAddress: string;
  agentId: string;
  subjectWalletAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
  controller?: string;
}

export interface IssueDidInput {
  contractAddress: string;
  agentId: string;
  subjectWalletAddress?: string;
  didDocument: string;
  didKeyHex?: string;
  controller?: string;
}

export interface UpdateDidInput {
  contractAddress: string;
  agentId: string;
  subjectWalletAddress?: string;
  didDocument: string;
  controller?: string;
}

export interface RevokeDidInput {
  contractAddress: string;
  agentId: string;
  subjectWalletAddress?: string;
  reason: string;
  didKeyHex?: string;
}

export interface DidRecord {
  agentId: string;
  subjectWalletAddress?: string;
  controller?: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure?: "disclosed" | "undisclosed";
  didDocument?: string;
  didKeyHex?: string;
  agentKeyHex: string;
  did?: string;
  didHashHex?: string;
  didCommitmentHex?: string;
  documentHashHex?: string;
  requestCommitmentHex?: string;
  proofCommitmentHex?: string;
  revocationCommitmentHex?: string;
  status: DidStatus;
  proofStatus: ProofStatus;
  txStatus: TxStatus;
  createdAt: string;
  updatedAt?: string;
  issuedAt?: string;
  revokedAt?: string;
  txHash?: string;
  txId?: string;
  mode: DeploymentMode;
}

export interface RegistrySummary {
  contractAddress: string;
  networkId: string;
  mode: DeploymentMode;
  totalRequests: number;
  totalActiveDids: number;
  totalRevokedDids: number;
  lastUpdatedAt: string;
}

export interface OwnerVaultStatus {
  hasLocalVault: false;
  contractAddress: string;
  matchesOnChain: null;
}

export interface RegistryAccess {
  contractAddress: string;
  isRegistryAdmin: boolean;
  isIssuer: boolean;
  registryAdminKeyHex?: string;
  issuerServiceKeyHex?: string;
}
