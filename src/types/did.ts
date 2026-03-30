export type DeploymentMode = "onchain" | "local-fallback";
export type DidStatus =
  | "pending_issuance"
  | "active"
  | "revoked"
  | "pending_update"
  | "pending_revocation";
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
}

export interface RequestDidInput {
  contractAddress: string;
  agentAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
}

export interface IssueDidInput {
  contractAddress: string;
  agentAddress: string;
  didDocument: string;
}

export interface UpdateDidInput {
  contractAddress: string;
  agentAddress: string;
  didDocument: string;
}

export interface RevokeDidInput {
  contractAddress: string;
  agentAddress: string;
  reason: string;
}

export interface DidRecord {
  agentAddress: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure?: "disclosed" | "undisclosed";
  didDocument?: string;
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

export interface RegistryAccess {
  contractAddress: string;
  isRegistryAdmin: boolean;
  isIssuer: boolean;
  registryAdminKeyHex?: string;
  issuerServiceKeyHex?: string;
}
