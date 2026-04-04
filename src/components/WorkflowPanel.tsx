import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { AppProviders } from "../../lib/providers";
import type { DidRecord } from "../types/did";
import type { BootstrapResponse, CustomerContext, DidRequestRow } from "../types/service";
import {
  approveDidRequest,
  bootstrapCustomer,
  checkDidServiceHealth,
  createAgentDidRequest,
  createMcpKey,
  getCustomerByWallet,
  listDidRequests,
} from "../utils/serviceApi";

interface WorkflowPanelProps {
  providers: AppProviders;
  walletAddress: string;
  contractAddress: string;
  mode: "user" | "admin";
  onIssueOnChain: (payload: {
    agentAddress: string;
    didDocument: string;
  }) => Promise<DidRecord>;
}

function requestAgentName(request: DidRequestRow): string {
  const value = request.request_payload?.agentName;
  return typeof value === "string" ? value : "";
}

type DashboardSection =
  | "overview"
  | "mcp"
  | "requests"
  | "human"
  | "admin";

export function WorkflowPanel({
  providers,
  walletAddress,
  contractAddress,
  mode,
  onIssueOnChain,
}: WorkflowPanelProps) {
  const [serviceHealth, setServiceHealth] = useState<string>("checking");
  const [customerContext, setCustomerContext] = useState<CustomerContext | null>(null);
  const [requests, setRequests] = useState<DidRequestRow[]>([]);
  const [adminQueue, setAdminQueue] = useState<DidRequestRow[]>([]);
  const [latestBootstrap, setLatestBootstrap] = useState<BootstrapResponse | null>(null);
  const [section, setSection] = useState<DashboardSection>("overview");
  const [mcpLabel, setMcpLabel] = useState("default-agent-key");
  const [agentPayloadName, setAgentPayloadName] = useState("Agent Smith");
  const [organizationName, setOrganizationName] = useState("Matrix Labs");
  const [organizationDisclosure, setOrganizationDisclosure] = useState<"disclosed" | "undisclosed">("disclosed");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const refreshDashboard = useCallback(async () => {
    if (!walletAddress) return;
    const [customer, customerRequests, pendingAdmin] = await Promise.all([
      getCustomerByWallet(walletAddress),
      getCustomerByWallet(walletAddress).then((ctx) =>
        ctx?.customer?.id ? listDidRequests({ customerId: ctx.customer.id }) : [],
      ),
      listDidRequests({ status: "pending_admin_review" }),
    ]);
    setCustomerContext(customer);
    setRequests(customerRequests);
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

  async function handleSimulateAgentRequest() {
    const plainKey =
      latestBootstrap?.mcpKey?.plainTextKey || customerContext?.mcpKeys?.[0]?.plainTextKey;
    if (!plainKey) {
      setMessage("Create or bootstrap an MCP key first. Existing keys do not expose their secret again.");
      return;
    }
    if (!contractAddress.trim()) {
      setMessage("Deploy or paste a contract address first.");
      return;
    }
    setBusyAction("agent-request");
    setMessage("");
    try {
      const request = await createAgentDidRequest({
        mcpKey: plainKey,
        contractAddress,
        networkId: providers.networkId,
        requesterWalletAddress: walletAddress,
        subjectWalletAddress: walletAddress,
        organizationName,
        organizationDisclosure,
        requestPayload: {
          agentName: agentPayloadName,
          organizationName,
          partialDisclosure: {
            ownership: true,
            name: true,
            organization: organizationDisclosure === "disclosed",
          },
        },
      });
      setMessage(`Agent request created: ${request.id}`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent request failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleApproveRequest(requestId: string) {
    setBusyAction(`approve:${requestId}`);
    setMessage("");
    try {
      await approveDidRequest(requestId, walletAddress);
      setMessage(`Human approval recorded for request ${requestId}`);
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
        agentName: requestAgentName(request) || agentPayloadName,
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
        agentAddress: request.subject_wallet_address,
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

  const quota = customerContext?.subscriptions?.[0];
  const activeKey = latestBootstrap?.mcpKey?.plainTextKey || null;
  const pendingHumanQueue = requests.filter(
    (request) => request.request_status === "pending_human_approval",
  );
  const issuedRequests = requests.filter(
    (request) => request.request_status === "issued",
  );
  const visibleSections = useMemo<DashboardSection[]>(
    () =>
      mode === "admin"
        ? ["overview", "admin"]
        : ["overview", "mcp", "requests", "human"],
    [mode],
  );

  useEffect(() => {
    if (!visibleSections.includes(section)) {
      setSection(visibleSections[0]);
    }
  }, [section, visibleSections]);

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

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">
          {mode === "admin" ? "Admin Review Workflow" : "Customer + MCP Workflow"}
        </CardTitle>
        <CardDescription className="text-zinc-400">
          {mode === "admin"
            ? "Review requests already approved by the human account and decide whether to issue them on-chain."
            : "Generate MCP keys, assign them to agents, collect DID requests, and approve the ones that should move to admin review."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {visibleSections.map((sectionId) => (
            <div key={sectionId}>
              {navButton(
                sectionId,
                {
                  overview: "Overview",
                  mcp: "MCP Keys",
                  requests: "Requests",
                  human: "Human Approval",
                  admin: "Admin Review",
                }[sectionId],
              )}
            </div>
          ))}
        </div>

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
            <strong>Quota:</strong> {quota ? `${quota.did_quota_remaining} / ${quota.did_quota_total}` : "no subscription"}
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">MCP Keys</div>
                  <div className="text-white text-lg">{customerContext.mcpKeys.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Pending Human Approval</div>
                  <div className="text-white text-lg">{pendingHumanQueue.length}</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                  <div className="text-zinc-500">Issued Requests</div>
                  <div className="text-white text-lg">{issuedRequests.length}</div>
                </div>
              </div>
            )}
          </>
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
                    customerContext.mcpKeys.map((key) => (
                      <div
                        key={key.id}
                        className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-1"
                      >
                        <div><span className="text-zinc-500">Label:</span> {key.label}</div>
                        <div><span className="text-zinc-500">Key ID:</span> <span className="font-mono break-all">{key.key_id}</span></div>
                        <div><span className="text-zinc-500">Status:</span> {key.status}</div>
                        <div><span className="text-zinc-500">Scopes:</span> {Array.isArray(key.scopes) ? key.scopes.join(", ") : "n/a"}</div>
                        <div><span className="text-zinc-500">Created:</span> {new Date(key.created_at).toLocaleString()}</div>
                        {key.last_used_at && (
                          <div><span className="text-zinc-500">Last used:</span> {new Date(key.last_used_at).toLocaleString()}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {section === "requests" && (
          <>
            {!customerContext ? (
              <p className="text-xs text-zinc-500">
                Bootstrap the customer account first. Then create an MCP key and use it to submit agent DID requests.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Agent Name</Label>
                  <Input
                    value={agentPayloadName}
                    onChange={(e) => setAgentPayloadName(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-white"
                  />
                  <Label className="text-zinc-300">Organization</Label>
                  <Input
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-white"
                  />
                  <Label className="text-zinc-300">Organization Disclosure</Label>
                  <select
                    value={organizationDisclosure}
                    onChange={(e) =>
                      setOrganizationDisclosure(
                        e.target.value as "disclosed" | "undisclosed",
                      )
                    }
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="disclosed">disclosed</option>
                    <option value="undisclosed">undisclosed</option>
                  </select>
                  <Button
                    type="button"
                    onClick={handleSimulateAgentRequest}
                    disabled={busyAction !== "" || !contractAddress.trim()}
                    className="bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    {busyAction === "agent-request" ? "Submitting..." : "Simulate Agent DID Request"}
                  </Button>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Requests Stored For This Customer</h3>
                  {requests.length === 0 ? (
                    <p className="text-xs text-zinc-500">No requests stored yet.</p>
                  ) : (
                    requests.map((request) => (
                      <div
                        key={request.id}
                        className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-1"
                      >
                        <div className="font-mono break-all">{request.id}</div>
                        <div><span className="text-zinc-500">Status:</span> {request.request_status}</div>
                        <div><span className="text-zinc-500">Agent Name:</span> {requestAgentName(request) || "n/a"}</div>
                        <div><span className="text-zinc-500">Subject Wallet:</span> {request.subject_wallet_address}</div>
                        <div><span className="text-zinc-500">Requested DID:</span> {request.requested_did || "pending derivation"}</div>
                        <div><span className="text-zinc-500">Created:</span> {new Date(request.created_at).toLocaleString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {section === "human" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Human Approval Queue</h3>
            {pendingHumanQueue.length === 0 ? (
              <p className="text-xs text-zinc-500">No requests pending human approval.</p>
            ) : (
              pendingHumanQueue.map((request) => (
                <div key={request.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-2">
                  <div className="font-mono break-all">{request.id}</div>
                  <div>Subject wallet: {request.subject_wallet_address}</div>
                  <div>Status: {request.request_status}</div>
                  <div>Agent Name: {requestAgentName(request) || "n/a"}</div>
                  <Button
                    type="button"
                    onClick={() => handleApproveRequest(request.id)}
                    disabled={busyAction !== ""}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    {busyAction === `approve:${request.id}` ? "Approving..." : "Approve as Human"}
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {section === "admin" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Admin Review Queue</h3>
            {adminQueue.length === 0 ? (
              <p className="text-xs text-zinc-500">No requests pending admin review.</p>
            ) : (
              adminQueue.map((request) => (
                <div key={request.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-2">
                  <div className="font-mono break-all">{request.id}</div>
                  <div>Subject wallet: {request.subject_wallet_address}</div>
                  <div>Requested DID: {request.requested_did}</div>
                  <div>Agent Name: {requestAgentName(request) || "n/a"}</div>
                  <div>Org disclosure: {request.organization_disclosure}</div>
                  <Button
                    type="button"
                    onClick={() => handleIssueRequest(request)}
                    disabled={busyAction !== "" || !contractAddress.trim()}
                    className="bg-purple-700 hover:bg-purple-600 text-white"
                  >
                    {busyAction === `issue:${request.id}` ? "Issuing..." : "Issue On-Chain as Admin"}
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {message && (
          <p className="text-xs text-zinc-300 break-all">{message}</p>
        )}
      </CardContent>
    </Card>
  );
}
