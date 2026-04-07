import type { DidRecord } from "../types/did";
import type {
  BootstrapResponse,
  CredentialBundle,
  CustomerContext,
  DidRequestRow,
  LogEntry,
  McpKey,
  RegistryDidRow,
  Subscription,
  VerifiableCredentialRow,
} from "../types/service";
import type { DeployResult } from "../types/did";

const API_BASE =
  (import.meta.env.VITE_DID_API_BASE_URL || "").trim() || "http://localhost:8787";
const MCP_BASE =
  (import.meta.env.VITE_DID_MCP_BASE_URL || "").trim() || "http://localhost:8788";

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function mcpUrl(path: string): string {
  return `${MCP_BASE}${path}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error || JSON.stringify(body);
  } catch {
    const text = await response.text();
    return text || `Request failed with status ${response.status}`;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

export function checkDidServiceHealth(): Promise<{ ok: boolean }> {
  return requestJson("/health");
}

export function fetchBackendLogs(limit = 200): Promise<{ entries: LogEntry[] }> {
  return requestJson(`/api/admin/logs?limit=${encodeURIComponent(String(limit))}`);
}

export async function fetchMcpLogs(limit = 200): Promise<{ entries: LogEntry[] }> {
  const response = await fetch(mcpUrl(`/logs?limit=${encodeURIComponent(String(limit))}`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as { entries: LogEntry[] };
}

export async function getCustomerByWallet(
  walletAddress: string,
): Promise<CustomerContext | null> {
  const response = await fetch(
    apiUrl(`/api/customers/by-wallet?walletAddress=${encodeURIComponent(walletAddress)}`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as CustomerContext;
}

export function bootstrapCustomer(payload: {
  walletAddress: string;
  email?: string;
  displayName?: string;
  didQuotaTotal?: number;
}): Promise<BootstrapResponse> {
  return requestJson("/api/demo/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function createMcpKey(payload: {
  customerId: string;
  label: string;
}): Promise<McpKey> {
  return requestJson(`/api/customers/${payload.customerId}/mcp-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      label: payload.label,
    }),
  });
}

export function revokeMcpKey(payload: {
  customerId: string;
  keyId: string;
}): Promise<McpKey> {
  return requestJson(`/api/customers/${payload.customerId}/mcp-keys/${payload.keyId}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function updateMcpKeyScopes(payload: {
  customerId: string;
  keyId: string;
  scopes: string[];
}): Promise<McpKey> {
  return requestJson(`/api/customers/${payload.customerId}/mcp-keys/${payload.keyId}/scopes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scopes: payload.scopes,
    }),
  });
}

export function createSubscription(payload: {
  customerId: string;
  planCode: string;
  didQuotaTotal: number;
  status?: "active" | "paused" | "expired";
  endsAt?: string;
}): Promise<Subscription> {
  return requestJson(`/api/customers/${payload.customerId}/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      planCode: payload.planCode,
      didQuotaTotal: payload.didQuotaTotal,
      status: payload.status,
      endsAt: payload.endsAt,
    }),
  });
}

export function createAgentDidRequest(payload: {
  mcpKey: string;
  contractAddress: string;
  networkId: string;
  agentId?: string;
  requesterWalletAddress: string;
  subjectWalletAddress: string;
  organizationName?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  requestPayload: Record<string, unknown>;
}): Promise<DidRequestRow> {
  return requestJson("/api/agent/did-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MCP-Key": payload.mcpKey,
    },
    body: JSON.stringify(payload),
  });
}

export function createWalletDidRequest(payload: {
  walletAddress: string;
  agentId?: string;
  subjectWalletAddress: string;
  contractAddress: string;
  networkId: string;
  organizationName?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  requestPayload: Record<string, unknown>;
  requestedDid?: string;
  onchainRequestTxId?: string;
  onchainRequestTxHash?: string;
}) {
  return requestJson("/api/wallet/did-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function getPersistedDidState(payload: {
  contractAddress: string;
  walletAddress: string;
  agentId?: string;
}): Promise<{
  request: DidRequestRow | null;
  record: {
    did?: string;
    contract_address: string;
    network_id: string;
    agent_id?: string | null;
    subject_wallet_address: string;
    subject_agent_key: string;
    issuer_wallet_address: string;
    status: string;
    organization_name?: string | null;
    organization_disclosure: "disclosed" | "undisclosed";
    did_commitment?: string | null;
    document_commitment?: string | null;
    proof_commitment?: string | null;
    revocation_commitment?: string | null;
    did_document?: Record<string, unknown>;
    created_at: string;
    issued_at: string;
    updated_at: string;
    revoked_at?: string | null;
  } | null;
}> {
  const params = new URLSearchParams({
    contractAddress: payload.contractAddress,
    walletAddress: payload.walletAddress,
  });
  if (payload.agentId) params.set("agentId", payload.agentId);
  return requestJson(`/api/wallet/did-state?${params.toString()}`);
}

export function listDidRequests(filters: {
  customerId?: string;
  status?: string;
}): Promise<DidRequestRow[]> {
  const params = new URLSearchParams();
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.status) params.set("status", filters.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`/api/did-requests${suffix}`);
}

export function getDidRequest(requestId: string): Promise<DidRequestRow> {
  return requestJson(`/api/did-requests/${requestId}`);
}

export function approveDidRequest(
  requestId: string,
  humanWalletAddress: string,
  onchainRequest?: {
    requestedDid?: string;
    onchainRequestTxId?: string;
    onchainRequestTxHash?: string;
  },
) {
  return requestJson<DidRequestRow>(`/api/human/did-requests/${requestId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      humanWalletAddress,
      requestedDid: onchainRequest?.requestedDid,
      onchainRequestTxId: onchainRequest?.onchainRequestTxId,
      onchainRequestTxHash: onchainRequest?.onchainRequestTxHash,
    }),
  });
}

export function rejectDidRequest(requestId: string, humanWalletAddress: string, reason: string) {
  return requestJson<DidRequestRow>(`/api/human/did-requests/${requestId}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ humanWalletAddress, reason }),
  });
}

export function finalizeIssuedDid(payload: {
  requestId: string;
  issuerWalletAddress: string;
  didDocument: Record<string, unknown>;
  didRecord: DidRecord;
  onchainRequestTxId?: string;
  onchainRequestTxHash?: string;
}) {
  return requestJson(`/api/admin/did-requests/${payload.requestId}/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      issuerWalletAddress: payload.issuerWalletAddress,
      didDocument: payload.didDocument,
      onchainRequestTxId: payload.onchainRequestTxId,
      onchainRequestTxHash: payload.onchainRequestTxHash,
      onchainIssueTxId: payload.didRecord.txId,
      onchainIssueTxHash: payload.didRecord.txHash,
      didCommitment: payload.didRecord.didCommitmentHex,
      documentCommitment: payload.didRecord.documentHashHex,
      proofCommitment: payload.didRecord.proofCommitmentHex,
    }),
  });
}

export function syncWalletIssuedDid(payload: {
  issuerWalletAddress: string;
  agentId: string;
  subjectWalletAddress: string;
  contractAddress: string;
  networkId: string;
  did: string;
  organizationName?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  requestPayload: Record<string, unknown>;
  didDocument: Record<string, unknown>;
  didCommitment?: string;
  documentCommitment?: string;
  proofCommitment?: string;
  onchainIssueTxId?: string;
  onchainIssueTxHash?: string;
}) {
  return requestJson("/api/wallet/dids/issue-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function syncWalletUpdatedDid(payload: {
  did: string;
  didDocument: Record<string, unknown>;
  documentCommitment?: string;
  proofCommitment?: string;
}) {
  return requestJson("/api/wallet/dids/update-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function syncWalletRevokedDid(payload: {
  did: string;
  revocationCommitment?: string;
}) {
  return requestJson("/api/wallet/dids/revoke-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function saveAdminRegistryDeployment(payload: {
  networkId: string;
  contractAddress: string;
  deployerWalletAddress: string;
  deployerShieldedAddress?: string;
  registryAdminWalletAddress?: string;
  issuerWalletAddress?: string;
  deployTxId?: string;
  deployTxHash?: string;
  initializeTxId?: string;
  initializeTxHash?: string;
  mode?: DeployResult["mode"];
  metadata?: Record<string, unknown>;
}) {
  return requestJson("/api/admin/registry-deployments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function getLatestAdminRegistryDeployment(filters: {
  networkId?: string;
  deployerWalletAddress?: string;
}): Promise<{
  contract_address: string;
  network_id: string;
  deployer_wallet_address: string;
  deployer_shielded_address?: string | null;
  registry_admin_wallet_address?: string | null;
  issuer_wallet_address?: string | null;
  deploy_tx_id?: string | null;
  deploy_tx_hash?: string | null;
  initialize_tx_id?: string | null;
  initialize_tx_hash?: string | null;
  deployment_mode: "onchain" | "local-fallback";
  created_at: string;
  updated_at: string;
} | null> {
  const params = new URLSearchParams();
  if (filters.networkId) params.set("networkId", filters.networkId);
  if (filters.deployerWalletAddress) {
    params.set("deployerWalletAddress", filters.deployerWalletAddress);
  }
  return requestJson(`/api/admin/registry-deployments/latest?${params.toString()}`);
}

export function listCredentialsByDid(did: string): Promise<VerifiableCredentialRow[]> {
  return requestJson(`/api/vcs/by-did?did=${encodeURIComponent(did)}`);
}

export function listRegistryDids(contractAddress: string): Promise<RegistryDidRow[]> {
  return requestJson(
    `/api/registry/dids?contractAddress=${encodeURIComponent(contractAddress)}`,
  );
}

export function createCredentialBundle(payload: {
  did: string;
  scopes: string[];
}): Promise<CredentialBundle> {
  return requestJson("/api/vcs/bundle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function verifyCredential(payload: {
  jwt: string;
}) {
  return requestJson("/api/vcs/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function verifyPresentation(payload: {
  presentation: {
    "@context": string[];
    type: string[];
    holder: string;
    verifiableCredential: string[];
  };
}): Promise<{
  valid: boolean;
  holder: string;
  credentialCount: number;
  verifiedCredentials: unknown[];
  warning?: string;
}> {
  return requestJson("/api/vps/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
