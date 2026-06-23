import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { AppProviders } from "../../lib/providers";
import type { DidRecord } from "../types/did";
import type {
  BootstrapResponse,
  CustomerContext,
  DidRequestRow,
  MidnightProofSubmission,
  ProofRequestRow,
} from "../types/service";
import type { MidnightProofVerificationPackage } from "../lib/proof-request";
import {
  approveProofRequest,
  approveDidRequest,
  bootstrapCustomer,
  checkDidServiceHealth,
  createMcpKey,
  createSubscription,
  deleteProofRequest,
  getCustomerByWallet,
  listDidRequests,
  listProofRequests,
  rejectProofRequest,
  revokeMcpKey,
  submitProofRequestProof,
  updateMcpKeyScopes,
} from "../utils/serviceApi";
import {
  isWalletApprovalRejected,
  signProofApprovalPayload,
} from "../lib/proof-approval";
import {
  createPreviewProofVerificationPackage,
  toMidnightProofRequest,
} from "../lib/proof-request";
import { createNativeOwnershipProofPackage } from "../lib/native-ownership-proof";
import { createLocalPreviewProofSubmission } from "../../lib/midnight-proof-envelope.js";

const MCP_SCOPE_OPTIONS = [
  "did.request",
  "did.status",
  "did.resolve",
  "did.validate",
  "did.credentials",
];

interface WorkflowPanelProps {
  providers: AppProviders;
  connectedApi: ConnectedAPI | null;
  walletAddress: string;
  contractAddress: string;
  mode: "user" | "admin";
  onIssueOnChain: (payload: {
    requestId?: string;
    contractAddress?: string;
    agentId: string;
    subjectWalletAddress?: string;
    didDocument: string;
  }) => Promise<DidRecord>;
  onApproveOnChain: (payload: {
    requestId: string;
    agentId: string;
    requesterWalletAddress: string;
    subjectWalletAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }) => Promise<DidRecord>;
  activeSection?: DashboardSection;
  onActiveSectionChange?: (section: DashboardSection) => void;
  showSectionNav?: boolean;
  showHeader?: boolean;
}

function requestAgentName(request: DidRequestRow): string {
  const value = request.request_payload?.agentName;
  return typeof value === "string" ? value : "";
}

type DashboardSection =
  | "overview"
  | "subscriptions"
  | "mcp"
  | "human"
  | "admin";

type HumanProofView = "pending" | "history";

interface ExpandableListItem {
  id: string;
  summary: ReactNode;
  details: ReactNode;
}

export function WorkflowPanel({
  providers,
  connectedApi,
  walletAddress,
  mode,
  onIssueOnChain,
  onApproveOnChain,
  activeSection,
  onActiveSectionChange,
  showSectionNav = true,
  showHeader = true,
}: WorkflowPanelProps) {
  const [serviceHealth, setServiceHealth] = useState<string>("checking");
  const [customerContext, setCustomerContext] = useState<CustomerContext | null>(null);
  const [requests, setRequests] = useState<DidRequestRow[]>([]);
  const [proofRequests, setProofRequests] = useState<ProofRequestRow[]>([]);
  const [adminQueue, setAdminQueue] = useState<DidRequestRow[]>([]);
  const [latestBootstrap, setLatestBootstrap] = useState<BootstrapResponse | null>(null);
  const [sectionState, setSectionState] = useState<DashboardSection>("overview");
  const [mcpLabel, setMcpLabel] = useState("default-agent-key");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [adminLookupWallet, setAdminLookupWallet] = useState("");
  const [adminCustomerContext, setAdminCustomerContext] = useState<CustomerContext | null>(null);
  const [subscriptionPlanCode, setSubscriptionPlanCode] = useState("manual-grant");
  const [subscriptionQuota, setSubscriptionQuota] = useState("5");
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState("");
  const [scopeDrafts, setScopeDrafts] = useState<Record<string, string[]>>({});
  const [humanProofView, setHumanProofView] = useState<HumanProofView>("pending");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, Record<string, boolean>>>({});
  const [proofPackages, setProofPackages] = useState<Record<string, MidnightProofVerificationPackage>>({});

  const refreshDashboard = useCallback(async () => {
    if (!walletAddress) return;
    const [customer, pendingAdmin] = await Promise.all([
      getCustomerByWallet(walletAddress),
      listDidRequests({ status: "pending_admin_review" }),
    ]);
    const customerId = customer?.customer?.id;
    const [customerRequests, customerProofRequests] = await Promise.all([
      customerId ? listDidRequests({ customerId }) : Promise.resolve([]),
      customerId ? listProofRequests({ customerId }) : Promise.resolve([]),
    ]);
    setCustomerContext(customer);
    setRequests(customerRequests);
    setProofRequests(customerProofRequests);
    setAdminQueue(pendingAdmin);
  }, [walletAddress]);

  useEffect(() => {
    checkDidServiceHealth()
      .then(() => setServiceHealth("online"))
      .catch(() => setServiceHealth("offline"));
  }, []);

  useEffect(() => {
    refreshDashboard().catch((error) => {
      console.error("[WorkflowPanel] dashboard refresh failed", error);
    });
  }, [refreshDashboard]);

  useEffect(() => {
    if (!customerContext?.mcpKeys) return;
    setScopeDrafts((current) => {
      const next = { ...current };
      for (const key of customerContext.mcpKeys) {
        if (!next[key.id]) {
          next[key.id] = Array.isArray(key.scopes) ? key.scopes : [];
        }
      }
      return next;
    });
  }, [customerContext]);

  async function handleBootstrap() {
    setBusyAction("bootstrap");
    setMessage("");
    try {
      const result = await bootstrapCustomer({
        walletAddress,
        displayName: "Wallet Customer",
        didQuotaTotal: 5,
      });
      setLatestBootstrap(result);
      setMessage(`Customer bootstrapped. MCP key created: ${result.mcpKey.plainTextKey}`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bootstrap failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateMcpKey() {
    if (!customerContext?.customer?.id) return;
    setBusyAction("mcp");
    setMessage("");
    try {
      const key = await createMcpKey({
        customerId: customerContext.customer.id,
        label: mcpLabel,
      });
      setMessage(`New MCP key created: ${key.plainTextKey}`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP key creation failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRevokeMcpKey(keyId: string) {
    if (!customerContext?.customer?.id) return;
    setBusyAction(`revoke-mcp:${keyId}`);
    setMessage("");
    try {
      await revokeMcpKey({
        customerId: customerContext.customer.id,
        keyId,
      });
      setMessage(`MCP key ${keyId} revoked.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP key revocation failed");
    } finally {
      setBusyAction("");
    }
  }

  function toggleScopeDraft(keyId: string, scope: string, checked: boolean) {
    setScopeDrafts((current) => {
      const existing = current[keyId] || [];
      const nextScopes = checked
        ? Array.from(new Set([...existing, scope]))
        : existing.filter((value) => value !== scope);
      return {
        ...current,
        [keyId]: nextScopes,
      };
    });
  }

  async function handleSaveMcpScopes(keyId: string) {
    if (!customerContext?.customer?.id) return;
    setBusyAction(`save-scopes:${keyId}`);
    setMessage("");
    try {
      await updateMcpKeyScopes({
        customerId: customerContext.customer.id,
        keyId,
        scopes: scopeDrafts[keyId] || [],
      });
      setMessage(`Updated scopes for MCP key ${keyId}.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP scope update failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleApproveRequest(request: DidRequestRow) {
    setBusyAction(`approve:${request.id}`);
    setMessage("");
    try {
      const rawDidDocument = request.request_payload?.didDocument;
      const didDocument =
        typeof rawDidDocument === "string"
          ? rawDidDocument
          : JSON.stringify(
              {
                id: request.requested_did || "",
                controller: request.subject_wallet_address,
                agentName: requestAgentName(request) || "Agent",
                organization:
                  request.organization_disclosure === "disclosed"
                    ? request.organization_name
                    : "undisclosed",
                service: [
                  {
                    id: "#agent-endpoint",
                    type: "AgentEndpoint",
                    serviceEndpoint: "https://agent.example.com",
                  },
                ],
              },
              null,
              2,
            );
      const onchainRequest = await onApproveOnChain({
        requestId: request.id,
        agentId: request.agent_id || "",
        requesterWalletAddress: request.requester_wallet_address,
        subjectWalletAddress: request.subject_wallet_address,
        agentName: requestAgentName(request) || undefined,
        organization: request.organization_name || undefined,
        organizationDisclosure: request.organization_disclosure,
        didDocument,
      });
      await approveDidRequest(request.id, walletAddress, {
        requestedDid: onchainRequest.did,
        onchainRequestTxId: onchainRequest.txId,
        onchainRequestTxHash: onchainRequest.txHash,
      });
      setMessage(`Human approval recorded and request registered on-chain for ${request.id}`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleIssueRequest(request: DidRequestRow) {
    setBusyAction(`issue:${request.id}`);
    setMessage("");
    try {
      const didDocument = {
        id: request.requested_did,
        controller: request.subject_wallet_address,
        agentName: requestAgentName(request) || "Agent",
        organization:
          request.organization_disclosure === "disclosed"
            ? request.organization_name
            : "undisclosed",
        service: [
          {
            id: "#agent-endpoint",
            type: "AgentEndpoint",
            serviceEndpoint: "https://agent.example.com",
          },
        ],
      };
      await onIssueOnChain({
        requestId: request.id,
        contractAddress: request.contract_address,
        agentId: request.agent_id || "",
        subjectWalletAddress: request.subject_wallet_address,
        didDocument: JSON.stringify(didDocument, null, 2),
      });
      setMessage(`Request ${request.id} issued on-chain and persisted in the DID service.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin issuance failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleApproveProofQueueRequest(request: ProofRequestRow) {
    setBusyAction(`approve-proof:${request.id}`);
    setMessage("");
    try {
      if (!connectedApi) {
        throw new Error("Connect the wallet before approving a proof request.");
      }
      const holderSignature = await signProofApprovalPayload(
        connectedApi,
        request.approval_payload,
      );
      await approveProofRequest(request.id, walletAddress, holderSignature);
      setMessage(`Proof request ${request.id} approved by the connected wallet.`);
      await refreshDashboard();
    } catch (error) {
      if (isWalletApprovalRejected(error)) {
        try {
          await rejectProofRequest(
            request.id,
            walletAddress,
            "Rejected by holder wallet from the approvals queue.",
          );
          setMessage(`Proof request ${request.id} was rejected in the wallet.`);
          await refreshDashboard();
          return;
        } catch (rejectError) {
          setMessage(
            rejectError instanceof Error
              ? rejectError.message
              : "Wallet rejected the proof request, but cleanup failed",
          );
          return;
        }
      }
      setMessage(error instanceof Error ? error.message : "Proof request approval failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRejectProofQueueRequest(request: ProofRequestRow) {
    setBusyAction(`reject-proof:${request.id}`);
    setMessage("");
    try {
      await rejectProofRequest(
        request.id,
        walletAddress,
        "Rejected by holder wallet from approvals queue.",
      );
      setMessage(`Proof request ${request.id} rejected.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof request rejection failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteProofQueueRequest(request: ProofRequestRow) {
    setBusyAction(`delete-proof:${request.id}`);
    setMessage("");
    try {
      await deleteProofRequest(request.id, walletAddress);
      setMessage(`Proof request ${request.id} deleted.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof request deletion failed");
    } finally {
      setBusyAction("");
    }
  }

  async function buildProofPackage(request: ProofRequestRow): Promise<MidnightProofVerificationPackage> {
    if (request.proof_material.nativeOwnership) {
      try {
        return await createNativeOwnershipProofPackage(providers, request);
      } catch (error) {
        console.warn("[WorkflowPanel] native proof package generation failed, falling back to preview envelope", error);
      }
    }

    const basePackage = createPreviewProofVerificationPackage(request);
    const previewSubmission = await createLocalPreviewProofSubmission({
      proofRequest: basePackage.proofRequest,
      submission: basePackage.submission,
    });
    return {
      proofRequest: basePackage.proofRequest,
      submission: previewSubmission,
    };
  }

  function getPersistedProofPackage(
    request: ProofRequestRow,
  ): MidnightProofVerificationPackage | null {
    if (!request.proof_submission) return null;
    return {
      proofRequest: toMidnightProofRequest(request),
      submission: request.proof_submission as unknown as MidnightProofSubmission,
    };
  }

  async function handleRegenerateProofPackage(request: ProofRequestRow) {
    setBusyAction(`regenerate-proof-package:${request.id}`);
    setMessage("");
    try {
      const nextPackage = await buildProofPackage(request);
      const submitted = await submitProofRequestProof(request.id, nextPackage.submission);
      const persistedPackage = {
        proofRequest: nextPackage.proofRequest,
        submission:
          submitted.proofRequest.proof_submission as unknown as MidnightProofSubmission,
      };
      setProofPackages((current) => ({
        ...current,
        [request.id]: persistedPackage,
      }));
      setProofRequests((current) =>
        current.map((row) => (row.id === request.id ? submitted.proofRequest : row)),
      );
      setExpandedGroups((current) => ({
        ...current,
        "proof-history": {
          ...(current["proof-history"] || {}),
          [request.id]: true,
        },
        "admin-proof-requests": {
          ...(current["admin-proof-requests"] || {}),
          [request.id]: true,
        },
      }));
      setMessage(`Verification package regenerated and persisted for proof request ${request.id}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to regenerate verification package",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleViewProofPackage(request: ProofRequestRow) {
    setBusyAction(`proof-package:${request.id}`);
    setMessage("");
    try {
      const nextPackage = getPersistedProofPackage(request);
      if (!nextPackage) {
        throw new Error("No persisted verification package found. Use Regenerate Proof to create one.");
      }
      setProofPackages((current) => ({
        ...current,
        [request.id]: nextPackage,
      }));
      setExpandedGroups((current) => ({
        ...current,
        "proof-history": {
          ...(current["proof-history"] || {}),
          [request.id]: true,
        },
        "admin-proof-requests": {
          ...(current["admin-proof-requests"] || {}),
          [request.id]: true,
        },
      }));
      setMessage(`Verification package generated for proof request ${request.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to build verification package");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCopyProofPackage(request: ProofRequestRow) {
    setBusyAction(`copy-proof-package:${request.id}`);
    setMessage("");
    try {
      const nextPackage =
        proofPackages[request.id] || getPersistedProofPackage(request);
      if (!nextPackage) {
        throw new Error("No persisted verification package found. Use Regenerate Proof to create one.");
      }
      setProofPackages((current) => ({
        ...current,
        [request.id]: nextPackage,
      }));
      await navigator.clipboard.writeText(JSON.stringify(nextPackage, null, 2));
      setMessage(`Verification package copied for proof request ${request.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to copy verification package");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAdminLookupCustomer() {
    if (!adminLookupWallet.trim()) {
      setMessage("Enter a wallet address to load the customer account.");
      return;
    }
    setBusyAction("subscription-lookup");
    setMessage("");
    try {
      const customer = await getCustomerByWallet(adminLookupWallet.trim());
      setAdminCustomerContext(customer);
      setMessage(
        customer
          ? `Loaded customer ${customer.customer.email}`
          : "No customer is linked to that wallet address yet.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer lookup failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAssignSubscription() {
    if (!adminCustomerContext?.customer?.id) {
      setMessage("Load a customer by wallet before assigning quota.");
      return;
    }
    const didQuotaTotal = Number(subscriptionQuota);
    if (!Number.isFinite(didQuotaTotal) || didQuotaTotal < 0) {
      setMessage("Quota must be a non-negative integer.");
      return;
    }
    const endsAt = subscriptionEndsAt.trim()
      ? new Date(subscriptionEndsAt).toISOString()
      : undefined;
    setBusyAction("subscription-create");
    setMessage("");
    try {
      await createSubscription({
        customerId: adminCustomerContext.customer.id,
        planCode: subscriptionPlanCode.trim() || "manual-grant",
        didQuotaTotal,
        status: "active",
        endsAt,
      });
      const refreshed = await getCustomerByWallet(adminLookupWallet.trim());
      setAdminCustomerContext(refreshed);
      if (
        refreshed?.customer?.linked_wallet_address &&
        refreshed.customer.linked_wallet_address === walletAddress
      ) {
        setCustomerContext(refreshed);
      }
      setMessage(
        `Assigned ${didQuotaTotal} DID quota to ${adminCustomerContext.customer.email}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Subscription assignment failed");
    } finally {
      setBusyAction("");
    }
  }

  const totalAssignedQuota = customerContext?.subscriptions?.reduce(
    (sum, subscription) => sum + Number(subscription.did_quota_total || 0),
    0,
  ) || 0;
  const registeredAgentCount = new Set(
    requests
      .filter((request) => request.request_status === "issued")
      .map((request) => `${request.contract_address}:${request.agent_id}`),
  ).size;
  const totalRemainingQuota = Math.max(0, totalAssignedQuota - registeredAgentCount);
  const activeKey = latestBootstrap?.mcpKey?.plainTextKey || null;
  const pendingHumanQueue = requests.filter(
    (request) => request.request_status === "pending_human_approval",
  );
  const pendingHumanProofQueue = proofRequests.filter(
    (request) => request.request_status === "pending_human_approval",
  );
  const approvedProofRequests = proofRequests.filter((request) =>
    ["proof_ready", "submitted", "verified"].includes(request.request_status),
  );
  const rejectedProofRequests = proofRequests.filter((request) =>
    ["human_rejected", "rejected"].includes(request.request_status),
  );
  const proofHistory = [...proofRequests]
    .filter((request) =>
      ["proof_ready", "submitted", "verified", "human_rejected", "rejected"].includes(
        request.request_status,
      ),
    )
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  const pendingDidApprovalItems: ExpandableListItem[] = pendingHumanQueue.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="text-zinc-500">
          DID · {requestAgentName(request) || "Unnamed agent"} · {request.subject_wallet_address}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-2">
        <div>Subject wallet: {request.subject_wallet_address}</div>
        <div>Agent ID: {request.agent_id || "n/a"}</div>
        <div>Status: {request.request_status}</div>
        <div>Agent Name: {requestAgentName(request) || "n/a"}</div>
        <Button
          type="button"
          onClick={() => handleApproveRequest(request)}
          disabled={busyAction !== ""}
          className="bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          {busyAction === `approve:${request.id}` ? "Approving..." : "Approve DID Request"}
        </Button>
      </div>
    ),
  }));
  const pendingProofApprovalItems: ExpandableListItem[] = pendingHumanProofQueue.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="text-zinc-500">
          Proof · {request.agent_id || "n/a"} · {Array.isArray(request.scopes) ? request.scopes.join(", ") : "n/a"}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-2">
        <div>DID: <span className="font-mono break-all">{request.did}</span></div>
        <div>Holder wallet: {request.holder_wallet_address}</div>
        <div>Agent ID: {request.agent_id || "n/a"}</div>
        <div>Scopes: {Array.isArray(request.scopes) ? request.scopes.join(", ") : "n/a"}</div>
        <div>Purpose: {request.purpose}</div>
        <Button
          type="button"
          onClick={() => handleApproveProofQueueRequest(request)}
          disabled={busyAction !== "" || !connectedApi}
          className="bg-amber-700 hover:bg-amber-600 text-white"
        >
          {busyAction === `approve-proof:${request.id}` ? "Signing..." : "Approve Proof Request"}
        </Button>
        <Button
          type="button"
          onClick={() => handleRejectProofQueueRequest(request)}
          disabled={busyAction !== ""}
          className="bg-red-700 hover:bg-red-600 text-white"
        >
          {busyAction === `reject-proof:${request.id}` ? "Rejecting..." : "Reject Proof Request"}
        </Button>
      </div>
    ),
  }));
  const proofHistoryItems: ExpandableListItem[] = proofHistory.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="flex items-center gap-2">
          {proofStatusChip(request)}
          <span className="text-zinc-500">{request.agent_id || "n/a"}</span>
        </div>
      </div>
    ),
    details: (
      <div className="space-y-2">
        <div>DID: <span className="font-mono break-all">{request.did}</span></div>
        <div>Holder wallet: {request.holder_wallet_address}</div>
        <div>Agent ID: {request.agent_id || "n/a"}</div>
        <div>Scopes: {Array.isArray(request.scopes) ? request.scopes.join(", ") : "n/a"}</div>
        <div>Updated: {new Date(request.updated_at).toLocaleString()}</div>
        {["proof_ready", "submitted", "verified"].includes(request.request_status) && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              onClick={() => handleViewProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {busyAction === `proof-package:${request.id}` ? "Loading..." : "View Verification Package"}
            </Button>
            <Button
              type="button"
              onClick={() => handleCopyProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {busyAction === `copy-proof-package:${request.id}` ? "Copying..." : "Copy Verification Package"}
            </Button>
            <Button
              type="button"
              onClick={() => handleRegenerateProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-zinc-800 hover:bg-zinc-700 text-white"
            >
              {busyAction === `regenerate-proof-package:${request.id}` ? "Regenerating..." : "Regenerate Proof"}
            </Button>
          </div>
        )}
        {!request.proof_submission && ["proof_ready", "submitted", "verified"].includes(request.request_status) && (
          <div className="text-zinc-500">
            No persisted verification package is stored for this proof yet. Use <span className="text-white">Regenerate Proof</span> to create and save one.
          </div>
        )}
        {proofPackages[request.id] && (
          <textarea
            readOnly
            value={JSON.stringify(proofPackages[request.id], null, 2)}
            rows={14}
            spellCheck={false}
            className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
          />
        )}
        {request.error_message && (
          <div><span className="text-zinc-500">Reason:</span> {request.error_message}</div>
        )}
      </div>
    ),
  }));
  const adminDidQueueItems: ExpandableListItem[] = adminQueue.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="text-zinc-500">
          {requestAgentName(request) || "Unnamed DID"} · {request.request_status}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-2">
        <div>Subject wallet: {request.subject_wallet_address}</div>
        <div>Agent ID: {request.agent_id || "n/a"}</div>
        <div>Contract: <span className="font-mono break-all">{request.contract_address}</span></div>
        <div>Request tx: <span className="font-mono break-all">{request.onchain_request_tx_id || "n/a"}</span></div>
        <div>Requested DID: {request.requested_did}</div>
        <div>Agent Name: {requestAgentName(request) || "n/a"}</div>
        <div>Org disclosure: {request.organization_disclosure}</div>
        <Button
          type="button"
          onClick={() => handleIssueRequest(request)}
          disabled={busyAction !== "" || !request.contract_address.trim()}
          className="bg-purple-700 hover:bg-purple-600 text-white"
        >
          {busyAction === `issue:${request.id}` ? "Issuing..." : "Issue On-Chain as Admin"}
        </Button>
      </div>
    ),
  }));
  const adminProofItems: ExpandableListItem[] = proofRequests.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="flex items-center gap-2">
          {proofStatusChip(request)}
          <span className="text-zinc-500">{request.agent_id || "n/a"}</span>
        </div>
      </div>
    ),
    details: (
      <div className="space-y-2">
        <div>DID: <span className="font-mono break-all">{request.did}</span></div>
        <div>Holder wallet: {request.holder_wallet_address}</div>
        <div>Agent ID: {request.agent_id || "n/a"}</div>
        <div>Scopes: {Array.isArray(request.scopes) ? request.scopes.join(", ") : "n/a"}</div>
        {["proof_ready", "submitted", "verified"].includes(request.request_status) && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              onClick={() => handleViewProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {busyAction === `proof-package:${request.id}` ? "Loading..." : "View Verification Package"}
            </Button>
            <Button
              type="button"
              onClick={() => handleCopyProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {busyAction === `copy-proof-package:${request.id}` ? "Copying..." : "Copy Verification Package"}
            </Button>
            <Button
              type="button"
              onClick={() => handleRegenerateProofPackage(request)}
              disabled={busyAction !== ""}
              className="bg-zinc-800 hover:bg-zinc-700 text-white"
            >
              {busyAction === `regenerate-proof-package:${request.id}` ? "Regenerating..." : "Regenerate Proof"}
            </Button>
          </div>
        )}
        {!request.proof_submission && ["proof_ready", "submitted", "verified"].includes(request.request_status) && (
          <div className="text-zinc-500">
            No persisted verification package is stored for this proof yet. Use <span className="text-white">Regenerate Proof</span> to create and save one.
          </div>
        )}
        {proofPackages[request.id] && (
          <textarea
            readOnly
            value={JSON.stringify(proofPackages[request.id], null, 2)}
            rows={14}
            spellCheck={false}
            className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
          />
        )}
        <Button
          type="button"
          onClick={() => handleDeleteProofQueueRequest(request)}
          disabled={busyAction !== ""}
          className="bg-red-700 hover:bg-red-600 text-white"
        >
          {busyAction === `delete-proof:${request.id}` ? "Deleting..." : "Delete Proof Request"}
        </Button>
      </div>
    ),
  }));
  const issuedRequests = requests.filter(
    (request) => request.request_status === "issued",
  );
  const recentRequests = [...requests].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  const requestHistoryItems: ExpandableListItem[] = recentRequests.map((request) => ({
    id: request.id,
    summary: (
      <div className="space-y-1">
        <div className="font-mono break-all">{request.id}</div>
        <div className="text-zinc-500">
          {requestAgentName(request) || "Unnamed agent"} · {request.request_status}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-1">
        <div><span className="text-zinc-500">Status:</span> {request.request_status}</div>
        <div><span className="text-zinc-500">Agent Name:</span> {requestAgentName(request) || "n/a"}</div>
        <div><span className="text-zinc-500">Agent ID:</span> {request.agent_id || "n/a"}</div>
        <div><span className="text-zinc-500">Wallet:</span> {request.subject_wallet_address}</div>
        <div><span className="text-zinc-500">Requested DID:</span> {request.requested_did || "pending derivation"}</div>
        <div><span className="text-zinc-500">Updated:</span> {new Date(request.updated_at).toLocaleString()}</div>
      </div>
    ),
  }));
  const userSubscriptionItems: ExpandableListItem[] = (customerContext?.subscriptions || []).map((subscription) => ({
    id: subscription.id,
    summary: (
      <div className="space-y-1">
        <div>{subscription.plan_code} · {subscription.status}</div>
        <div className="text-zinc-500">
          quota {subscription.did_quota_total} · remaining {Math.max(0, Number(subscription.did_quota_total || 0) - registeredAgentCount)}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-1">
        <div><span className="text-zinc-500">Plan:</span> {subscription.plan_code}</div>
        <div><span className="text-zinc-500">Status:</span> {subscription.status}</div>
        <div><span className="text-zinc-500">Assigned quota:</span> {subscription.did_quota_total}</div>
        <div><span className="text-zinc-500">Displayed remaining quota:</span> {Math.max(0, Number(subscription.did_quota_total || 0) - registeredAgentCount)}</div>
        <div><span className="text-zinc-500">Started:</span> {new Date(subscription.starts_at).toLocaleString()}</div>
        {subscription.ends_at && (
          <div><span className="text-zinc-500">Ends:</span> {new Date(subscription.ends_at).toLocaleString()}</div>
        )}
      </div>
    ),
  }));
  const adminSubscriptionItems: ExpandableListItem[] = (adminCustomerContext?.subscriptions || []).map((subscription) => ({
    id: subscription.id,
    summary: (
      <div className="space-y-1">
        <div>{subscription.plan_code} · {subscription.status}</div>
        <div className="text-zinc-500">
          quota {subscription.did_quota_total} · remaining {Math.max(0, Number(subscription.did_quota_total || 0) - registeredAgentCount)}
        </div>
      </div>
    ),
    details: (
      <div className="space-y-1">
        <div><span className="text-zinc-500">Plan:</span> {subscription.plan_code}</div>
        <div><span className="text-zinc-500">Status:</span> {subscription.status}</div>
        <div><span className="text-zinc-500">Assigned quota:</span> {subscription.did_quota_total}</div>
        <div><span className="text-zinc-500">Displayed remaining quota:</span> {Math.max(0, Number(subscription.did_quota_total || 0) - registeredAgentCount)}</div>
        <div><span className="text-zinc-500">Started:</span> {new Date(subscription.starts_at).toLocaleString()}</div>
        {subscription.ends_at && (
          <div><span className="text-zinc-500">Ends:</span> {new Date(subscription.ends_at).toLocaleString()}</div>
        )}
      </div>
    ),
  }));
  const mcpKeyItems: ExpandableListItem[] = (customerContext?.mcpKeys || []).map((key) => ({
    id: key.id,
    summary: (
      <div className="space-y-1">
        <div>{key.label} · {key.status}</div>
        <div className="text-zinc-500 font-mono break-all">{key.key_id}</div>
      </div>
    ),
    details: (
      <div className="space-y-3">
        <div className="space-y-1">
          <div><span className="text-zinc-500">Label:</span> {key.label}</div>
          <div><span className="text-zinc-500">Key ID:</span> <span className="font-mono break-all">{key.key_id}</span></div>
          <div><span className="text-zinc-500">Status:</span> {key.status}</div>
          <div><span className="text-zinc-500">Scopes:</span> {Array.isArray(key.scopes) ? key.scopes.join(", ") : "n/a"}</div>
          <div><span className="text-zinc-500">Created:</span> {new Date(key.created_at).toLocaleString()}</div>
          {key.last_used_at && (
            <div><span className="text-zinc-500">Last used:</span> {new Date(key.last_used_at).toLocaleString()}</div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-zinc-500">Edit scopes</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {MCP_SCOPE_OPTIONS.map((scope) => {
              const checked = (scopeDrafts[key.id] || []).includes(scope);
              return (
                <label
                  key={scope}
                  className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleScopeDraft(key.id, scope, e.target.checked)}
                  />
                  <span className="font-mono text-[11px]">{scope}</span>
                </label>
              );
            })}
          </div>
          <Button
            type="button"
            onClick={() => handleSaveMcpScopes(key.id)}
            disabled={busyAction !== "" || (scopeDrafts[key.id] || []).length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {busyAction === `save-scopes:${key.id}` ? "Saving..." : "Save Scopes"}
          </Button>
        </div>
        <Button
          type="button"
          onClick={() => handleRevokeMcpKey(key.id)}
          disabled={busyAction !== "" || key.status !== "active"}
          className="bg-red-700 hover:bg-red-600 text-white"
        >
          {busyAction === `revoke-mcp:${key.id}` ? "Revoking..." : "Revoke MCP Key"}
        </Button>
      </div>
    ),
  }));
  const visibleSections = useMemo<DashboardSection[]>(
    () =>
      mode === "admin"
        ? ["overview", "subscriptions", "admin"]
        : ["overview", "subscriptions", "mcp", "human"],
    [mode],
  );

  const section = activeSection ?? sectionState;
  const sectionTitle =
    mode === "admin"
      ? "Admin Review"
      : {
          overview: "Overview",
          subscriptions: "Subscriptions",
          mcp: "MCP Keys",
          human: "Approvals",
          admin: "Admin Review",
        }[section];
  const sectionDescription =
    mode === "admin"
      ? "Review requests already approved by the human account and decide whether to issue them on-chain."
      : {
          overview:
            "Customer account summary, current quota state, and MCP workflow status.",
          subscriptions:
            "Inspect the assigned DID quota and active plans for this customer account.",
          mcp:
            "Generate, inspect, and revoke MCP keys issued to the customer-controlled agents.",
          human:
            "Review and approve incoming DID requests before they move into admin review.",
          admin:
            "Review requests already approved by the human account and decide whether to issue them on-chain.",
        }[section];

  useEffect(() => {
    if (!visibleSections.includes(section)) {
      if (activeSection == null) {
        setSectionState(visibleSections[0]);
      }
      onActiveSectionChange?.(visibleSections[0]);
    }
  }, [activeSection, onActiveSectionChange, section, visibleSections]);

  function setSection(nextSection: DashboardSection) {
    if (activeSection == null) {
      setSectionState(nextSection);
    }
    onActiveSectionChange?.(nextSection);
  }

  function navButton(id: DashboardSection, label: string) {
    const active = section === id;
    return (
      <button
        type="button"
        onClick={() => setSection(id)}
        className={`rounded-md px-3 py-2 text-xs font-medium transition ${
          active
            ? "bg-emerald-600 text-white"
            : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        {label}
      </button>
    );
  }

  function isExpanded(group: string, itemId: string): boolean {
    return Boolean(expandedGroups[group]?.[itemId]);
  }

  function toggleExpanded(group: string, itemId: string) {
    setExpandedGroups((current) => ({
      ...current,
      [group]: {
        ...(current[group] || {}),
        [itemId]: !current[group]?.[itemId],
      },
    }));
  }

  function setAllExpanded(group: string, items: ExpandableListItem[], expanded: boolean) {
    setExpandedGroups((current) => ({
      ...current,
      [group]: Object.fromEntries(items.map((item) => [item.id, expanded])),
    }));
  }

  function renderExpandableList(
    group: string,
    items: ExpandableListItem[],
    emptyMessage: string,
  ) {
    if (items.length === 0) {
      return <p className="text-xs text-zinc-500">{emptyMessage}</p>;
    }
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAllExpanded(group, items, true)}
            className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setAllExpanded(group, items, false)}
            className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Collapse all
          </button>
        </div>
        {items.map((item) => {
          const expanded = isExpanded(group, item.id);
          return (
            <div key={item.id} className="rounded-md border border-zinc-800 bg-zinc-950 text-xs text-zinc-300">
              <button
                type="button"
                onClick={() => toggleExpanded(group, item.id)}
                className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition hover:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">{item.summary}</div>
                <span className="shrink-0 text-zinc-500">{expanded ? "˄" : "˅"}</span>
              </button>
              {expanded && <div className="border-t border-zinc-800 px-3 py-3">{item.details}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function proofStatusChip(request: ProofRequestRow) {
    const approved = ["proof_ready", "submitted", "verified"].includes(request.request_status);
    const rejected = ["human_rejected", "rejected"].includes(request.request_status);
    const className = approved
      ? "bg-emerald-600 text-white"
      : rejected
        ? "bg-red-700 text-white"
        : "bg-zinc-950 text-zinc-300";
    return (
      <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${className}`}>
        {request.request_status}
      </span>
    );
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      {showHeader && (
        <CardHeader>
          <CardTitle className="text-white">{sectionTitle}</CardTitle>
          <CardDescription className="text-zinc-400">
            {sectionDescription}
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className="space-y-6">
        {showSectionNav && (
          <div className="flex flex-wrap gap-2">
            {visibleSections.map((sectionId) => (
              <div key={sectionId}>
                {navButton(
                  sectionId,
                  {
                    overview: "Overview",
                    subscriptions: "Subscriptions",
                    mcp: "MCP Keys",
                    human: "Approvals",
                    admin: "Admin Review",
                  }[sectionId],
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          <div>
            <strong>Service:</strong> {serviceHealth}
          </div>
          <div>
            <strong>Wallet Login:</strong> {walletAddress}
          </div>
          <div>
            <strong>Customer:</strong> {customerContext?.customer?.email || "not bootstrapped yet"}
          </div>
          <div>
            <strong>Agents / Quota:</strong> {customerContext ? `${registeredAgentCount} / ${totalAssignedQuota}` : "no subscription"}
          </div>
          <div>
            <strong>Remaining DID quota:</strong> {customerContext ? totalRemainingQuota : "n/a"}
          </div>
        </div>

        {section === "overview" && (
          <>
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300 space-y-2">
              <div className="font-semibold text-white">Current operating model</div>
              <p>
                The human wallet is the customer login. This human generates MCP keys, approves incoming agent requests, and can also act as admin issuer when this wallet matches the contract issuer.
              </p>
              <p>
                MCP keys are generated here and stored hashed in Postgres. Their plaintext value is shown only when created and must then be handed to the agent securely.
              </p>
              <p>
                Requests, requester-authored payloads, DID documents, and issuance records are persisted in Postgres. The chain stores only the public registry state and commitments.
              </p>
              {mode === "user" ? (
                <p>
                  This user-facing area is for customer control only: multiple agent wallets, MCP key assignment, and human approvals before anything reaches the admin queue.
                </p>
              ) : (
                <p>
                  This admin-facing area intentionally omits DID request, MCP key, and VC controls. Admin here only reviews the queue and issues approved requests on-chain.
                </p>
              )}
            </div>

            {!customerContext && mode === "user" && (
              <Button
                type="button"
                onClick={handleBootstrap}
                disabled={busyAction !== ""}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {busyAction === "bootstrap" ? "Bootstrapping..." : "Bootstrap Customer Account"}
              </Button>
            )}

            {customerContext && (
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">MCP Keys</div>
                  <div className="text-white text-lg">{customerContext.mcpKeys.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Pending Human Approval</div>
                  <div className="text-white text-lg">{pendingHumanQueue.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Pending Proof Approval</div>
                  <div className="text-white text-lg">{pendingHumanProofQueue.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Approved Proofs</div>
                  <div className="text-white text-lg">{approvedProofRequests.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Rejected Proofs</div>
                  <div className="text-white text-lg">{rejectedProofRequests.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Issued Requests</div>
                  <div className="text-white text-lg">{issuedRequests.length}</div>
                </div>
              </div>
            )}

            {mode === "user" && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Request History</h3>
                {recentRequests.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No DID requests stored for this customer account yet.
                  </p>
                ) : (
                  renderExpandableList("request-history", requestHistoryItems, "")
                )}
              </div>
            )}
          </>
        )}

        {section === "subscriptions" && (
          <div className="space-y-4">
            {mode === "user" && (
              <>
                {!customerContext ? (
                  <p className="text-xs text-zinc-500">
                    Bootstrap the customer account first. Subscriptions and quota are attached to that customer.
                  </p>
                ) : customerContext.subscriptions.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No subscriptions assigned yet. An admin must grant DID quota before an MCP key can create DID requests.
                  </p>
                ) : (
                  renderExpandableList("user-subscriptions", userSubscriptionItems, "")
                )}
              </>
            )}

            {mode === "admin" && (
              <div className="space-y-4">
                <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <Label htmlFor="adminLookupWallet" className="text-zinc-300">
                    Customer Wallet Address
                  </Label>
                  <Input
                    id="adminLookupWallet"
                    value={adminLookupWallet}
                    onChange={(e) => setAdminLookupWallet(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-white"
                    placeholder="mn_addr_preprod1..."
                  />
                  <Button
                    type="button"
                    onClick={handleAdminLookupCustomer}
                    disabled={busyAction !== ""}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {busyAction === "subscription-lookup" ? "Loading..." : "Load Customer"}
                  </Button>
                </div>

                {adminCustomerContext && (
                  <>
                    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-1">
                      <div><span className="text-zinc-500">Customer:</span> {adminCustomerContext.customer.email}</div>
                      <div><span className="text-zinc-500">Display name:</span> {adminCustomerContext.customer.display_name}</div>
                      <div><span className="text-zinc-500">Linked wallet:</span> {adminCustomerContext.customer.linked_wallet_address || "n/a"}</div>
                    </div>

                    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <Label htmlFor="subscriptionPlanCode" className="text-zinc-300">
                        Plan Code
                      </Label>
                      <Input
                        id="subscriptionPlanCode"
                        value={subscriptionPlanCode}
                        onChange={(e) => setSubscriptionPlanCode(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-white"
                      />
                      <Label htmlFor="subscriptionQuota" className="text-zinc-300">
                        DID Quota
                      </Label>
                      <Input
                        id="subscriptionQuota"
                        type="number"
                        min="0"
                        step="1"
                        value={subscriptionQuota}
                        onChange={(e) => setSubscriptionQuota(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-white"
                      />
                      <Label htmlFor="subscriptionEndsAt" className="text-zinc-300">
                        Ends At
                      </Label>
                      <Input
                        id="subscriptionEndsAt"
                        type="datetime-local"
                        value={subscriptionEndsAt}
                        onChange={(e) => setSubscriptionEndsAt(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-white"
                      />
                      <Button
                        type="button"
                        onClick={handleAssignSubscription}
                        disabled={busyAction !== ""}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        {busyAction === "subscription-create" ? "Assigning..." : "Assign Subscription / Quota"}
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-white">Existing Subscriptions</h3>
                      {adminCustomerContext.subscriptions.length === 0 ? (
                        <p className="text-xs text-zinc-500">No subscriptions assigned yet.</p>
                      ) : (
                        renderExpandableList("admin-subscriptions", adminSubscriptionItems, "")
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {section === "mcp" && (
          <>
            {!customerContext ? (
              <p className="text-xs text-zinc-500">
                Bootstrap the customer account first. MCP keys are generated and assigned by the human account.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mcpLabel" className="text-zinc-300">
                    New MCP Key Label
                  </Label>
                  <Input
                    id="mcpLabel"
                    value={mcpLabel}
                    onChange={(e) => setMcpLabel(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-white"
                  />
                  <Button
                    type="button"
                    onClick={handleCreateMcpKey}
                    disabled={busyAction !== ""}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {busyAction === "mcp" ? "Creating..." : "Create MCP Key"}
                  </Button>
                </div>

                {activeKey && (
                  <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 break-all">
                    <div className="text-zinc-500">Last generated plaintext MCP key</div>
                    <div className="font-mono text-emerald-400">{activeKey}</div>
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Assigned MCP Keys</h3>
                  {customerContext.mcpKeys.length === 0 ? (
                    <p className="text-xs text-zinc-500">No MCP keys created yet.</p>
                  ) : (
                    renderExpandableList("mcp-keys", mcpKeyItems, "")
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {section === "human" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setHumanProofView("pending")}
                className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                  humanProofView === "pending"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setHumanProofView("history")}
                className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                  humanProofView === "history"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                History
              </button>
            </div>

            {humanProofView === "pending" && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Human Approval Queue</h3>
                {pendingHumanQueue.length === 0 && pendingHumanProofQueue.length === 0 ? (
                  <p className="text-xs text-zinc-500">No requests pending human approval.</p>
                ) : (
                  <>
                    {renderExpandableList("pending-did-approvals", pendingDidApprovalItems, "")}
                    {renderExpandableList("pending-proof-approvals", pendingProofApprovalItems, "")}
                  </>
                )}
              </div>
            )}

            {humanProofView === "history" && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Proof History</h3>
                {proofHistory.length === 0 ? (
                  <p className="text-xs text-zinc-500">No approved or rejected proof requests yet.</p>
                ) : (
                  renderExpandableList("proof-history", proofHistoryItems, "")
                )}
              </div>
            )}
          </div>
        )}

        {section === "admin" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Admin Review Queue</h3>
            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                <div className="text-zinc-500">Approved Proofs</div>
                <div className="text-white text-lg">{approvedProofRequests.length}</div>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                <div className="text-zinc-500">Rejected Proofs</div>
                <div className="text-white text-lg">{rejectedProofRequests.length}</div>
              </div>
            </div>
            {adminQueue.length === 0 ? (
              <p className="text-xs text-zinc-500">No requests pending admin review.</p>
            ) : (
              renderExpandableList("admin-did-queue", adminDidQueueItems, "")
            )}

            <div className="pt-3 space-y-3">
              <h3 className="text-sm font-semibold text-white">Proof Requests</h3>
              {proofRequests.length === 0 ? (
                <p className="text-xs text-zinc-500">No proof requests stored for this customer.</p>
              ) : (
                renderExpandableList("admin-proof-requests", adminProofItems, "")
              )}
            </div>
          </div>
        )}

        {message && (
          <p className="text-xs text-zinc-300 break-all">{message}</p>
        )}
      </CardContent>
    </Card>
  );
}
