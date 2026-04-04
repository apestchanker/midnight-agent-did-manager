import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { WalletPanel } from "../components/WalletPanel";
import { useWallet } from "../hooks/useWallet";
import type { StorageMode } from "../lib/providers";
import { DeployPanel } from "./components/DeployPanel";
import { RequestForm } from "./components/RequestForm";
import { DidDisplay } from "./components/DidDisplay";
import { IssuerPanel } from "./components/IssuerPanel";
import { OwnerVaultPanel } from "./components/OwnerVaultPanel";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { VcPanel } from "./components/VcPanel";
import type { DidRecord, DeployResult, RegistryAccess, RegistrySummary } from "./types/did";
import type { DidRequestRow, RegistryDidRow } from "./types/service";
import { APP_VERSION } from "./lib/version";
import {
  fetchRegistryAccess,
  fetchDidRecord,
  fetchRegistrySummary,
  getSavedContractAddress,
  getSavedDeployment,
  issueDid,
  requestDid,
  revokeDid,
  updateDid,
} from "./lib/didContract";
import {
  createWalletDidRequest,
  finalizeIssuedDid,
  getDidRequest,
  getCustomerByWallet,
  getLatestAdminRegistryDeployment,
  listDidRequests,
  listRegistryDids,
  saveAdminRegistryDeployment,
} from "./utils/serviceApi";

const SECTION_IDS = {
  wallet: "wallet-access",
  agents: "my-agents",
  registry: "registry-setup",
  registryDirectory: "registry-directory",
  request: "did-request",
  issuer: "issuer-actions",
  credentials: "credentials",
  workflow: "workflow",
} as const;

export default function App() {
  type ViewMode = "user" | "admin" | "registry";
  type SidebarItem = {
    id: string;
    label: string;
    shortLabel: string;
  };
  type AgentSummary = {
    subjectWalletAddress: string;
    latestRequestId: string;
    latestStatus: string;
    latestDid?: string | null;
    latestUpdatedAt: string;
    agentName?: string;
  };
  function getRequestAgentName(request: DidRequestRow): string {
    const value = request.request_payload?.agentName;
    return typeof value === "string" ? value : "";
  }
  const rawEnv = import.meta.env as Record<string, string | undefined>;
  const appTitle = (rawEnv.VITE_APP_TITLE || "Midnight Agent DID Manager").trim();
  const versionedAppTitle = `${appTitle} v${APP_VERSION}`;
  const configuredAdminShieldedAddress = (
    rawEnv.VITE_ADMIN_WALLET_SHIELDED_ADDR ||
    rawEnv.ADMIN_WALLET_SHIELDED_ADDR ||
    ""
  )
    .trim()
    .toLowerCase();
  const LAST_CONTRACT_KEY = "did-registry:last-contract-address:v1";
  const LAST_AGENT_KEY = "did-registry:last-agent-address:v1";
  const STORAGE_MODE_KEY = "did-registry:storage-mode:v1";
  const [storageMode, setStorageMode] = useState<StorageMode>(() => {
    if (typeof window === "undefined") return "app_local";
    const saved = window.localStorage.getItem(STORAGE_MODE_KEY);
    return saved === "patched_sdk" ? "patched_sdk" : "app_local";
  });
  const {
    status,
    address,
    providers,
    error: walletError,
    connect,
    availableWallets,
    selectedWalletName,
    setSelectedWalletName,
    connectedWalletName,
    pendingRemoteProverApproval,
    approveRemoteProver,
    declineRemoteProver,
  } = useWallet(storageMode);

  useEffect(() => {
    document.title = versionedAppTitle;
  }, [versionedAppTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_MODE_KEY, storageMode);
  }, [storageMode]);

  const [contractAddress, setContractAddress] = useState("");
  const [selectedAgentAddress, setSelectedAgentAddress] = useState("");
  const [didRecord, setDidRecord] = useState<DidRecord | null>(null);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [registryAccess, setRegistryAccess] = useState<RegistryAccess | null>(null);
  const [customerRequests, setCustomerRequests] = useState<DidRequestRow[]>([]);
  const [adminRequests, setAdminRequests] = useState<DidRequestRow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("user");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(true);
  const [adminDidsPanelOpen, setAdminDidsPanelOpen] = useState(true);
  const [adminDidSearch, setAdminDidSearch] = useState("");
  const [registryPanelOpen, setRegistryPanelOpen] = useState(true);
  const [registryDidSearch, setRegistryDidSearch] = useState("");
  const [newAgentMode, setNewAgentMode] = useState(false);
  const [registrySummary, setRegistrySummary] = useState<RegistrySummary | null>(
    null,
  );
  const [registryDids, setRegistryDids] = useState<RegistryDidRow[]>([]);

  const walletAddress = useMemo(() => address || "", [address]);
  const isConfiguredAdminWallet = useMemo(() => {
    if (!configuredAdminShieldedAddress || !providers?.shieldedAddress) return false;
    return (
      providers.shieldedAddress.trim().toLowerCase() ===
      configuredAdminShieldedAddress
    );
  }, [configuredAdminShieldedAddress, providers?.shieldedAddress]);
  const hasAdminAccess = Boolean(
    isConfiguredAdminWallet ||
      registryAccess?.isIssuer ||
      registryAccess?.isRegistryAdmin,
  );
  const managedAgents = useMemo<AgentSummary[]>(() => {
    const latestByWallet = new Map<string, DidRequestRow>();
    for (const request of customerRequests) {
      const current = latestByWallet.get(request.subject_wallet_address);
      if (!current) {
        latestByWallet.set(request.subject_wallet_address, request);
        continue;
      }
      if (
        new Date(request.updated_at).getTime() >=
        new Date(current.updated_at).getTime()
      ) {
        latestByWallet.set(request.subject_wallet_address, request);
      }
    }
    return Array.from(latestByWallet.values())
      .map((request) => ({
        subjectWalletAddress: request.subject_wallet_address,
        latestRequestId: request.id,
        latestStatus: request.request_status,
        latestDid: request.requested_did,
        latestUpdatedAt: request.updated_at,
        agentName: getRequestAgentName(request) || undefined,
      }))
      .sort(
        (a, b) =>
          new Date(b.latestUpdatedAt).getTime() -
          new Date(a.latestUpdatedAt).getTime(),
      );
  }, [customerRequests]);
  const activeAgentSummary = useMemo(
    () =>
      managedAgents.find(
        (agent) => agent.subjectWalletAddress === selectedAgentAddress,
      ) || null,
    [managedAgents, selectedAgentAddress],
  );
  const userCanOpenAgentFlows = Boolean(activeAgentSummary || newAgentMode);
  const adminDids = useMemo(() => {
    const latestByWallet = new Map<string, DidRequestRow>();
    for (const request of adminRequests) {
      const current = latestByWallet.get(request.subject_wallet_address);
      if (
        !current ||
        new Date(request.updated_at).getTime() >=
          new Date(current.updated_at).getTime()
      ) {
        latestByWallet.set(request.subject_wallet_address, request);
      }
    }
    return Array.from(latestByWallet.values()).sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [adminRequests]);
  const filteredAdminDids = useMemo(() => {
    const needle = adminDidSearch.trim().toLowerCase();
    if (!needle) return adminDids;
    return adminDids.filter((request) => {
      const agentName = getRequestAgentName(request).toLowerCase();
      return (
        request.subject_wallet_address.toLowerCase().includes(needle) ||
        String(request.requested_did || "").toLowerCase().includes(needle) ||
        agentName.includes(needle) ||
        String(request.organization_name || "").toLowerCase().includes(needle)
      );
    });
  }, [adminDidSearch, adminDids]);
  const selectedAdminDid = useMemo(
    () =>
      adminDids.find(
        (request) => request.subject_wallet_address === selectedAgentAddress,
      ) || null,
    [adminDids, selectedAgentAddress],
  );
  const filteredRegistryDids = useMemo(() => {
    const needle = registryDidSearch.trim().toLowerCase();
    if (!needle) return registryDids;
    return registryDids.filter((record) => {
      const agentName = String(record.public_agent_name || "").toLowerCase();
      return (
        record.subject_wallet_address.toLowerCase().includes(needle) ||
        record.did.toLowerCase().includes(needle) ||
        agentName.includes(needle) ||
        String(record.organization_name || "").toLowerCase().includes(needle)
      );
    });
  }, [registryDidSearch, registryDids]);
  const selectedRegistryDid = useMemo(
    () =>
      registryDids.find(
        (record) => record.subject_wallet_address === selectedAgentAddress,
      ) || null,
    [registryDids, selectedAgentAddress],
  );

  const refreshRequestCollections = useCallback(async () => {
    if (!walletAddress.trim()) {
      setCustomerRequests([]);
      setAdminRequests([]);
      return;
    }

    const [customer, pendingAdmin] = await Promise.all([
      getCustomerByWallet(walletAddress),
      listDidRequests({ status: "pending_admin_review" }),
    ]);

    if (customer?.customer?.id) {
      setCustomerRequests(
        await listDidRequests({ customerId: customer.customer.id }),
      );
    } else {
      setCustomerRequests([]);
    }
    setAdminRequests(pendingAdmin);
  }, [walletAddress]);

  useEffect(() => {
    const savedAddress = getSavedContractAddress();
    const savedDeployment = getSavedDeployment();
    const viewedContract =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_CONTRACT_KEY)
        : "";
    const viewedAgent =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_AGENT_KEY)
        : "";
    if (viewedContract || savedAddress) setContractAddress(viewedContract || savedAddress);
    if (viewedAgent) setSelectedAgentAddress(viewedAgent);
    if (savedDeployment) setDeployResult(savedDeployment);
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setSelectedAgentAddress("");
    }
  }, [walletAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (contractAddress.trim()) {
      window.localStorage.setItem(LAST_CONTRACT_KEY, contractAddress.trim());
    }
  }, [contractAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedAgentAddress.trim()) {
      window.localStorage.setItem(LAST_AGENT_KEY, selectedAgentAddress.trim());
    }
  }, [selectedAgentAddress]);

  useEffect(() => {
    if (viewMode !== "user") return;
    if (newAgentMode) return;
    if (managedAgents.length === 0) {
      setSelectedAgentAddress("");
      return;
    }
    const currentExists = managedAgents.some(
      (agent) => agent.subjectWalletAddress === selectedAgentAddress,
    );
    if (!currentExists) {
      setSelectedAgentAddress("");
    }
  }, [managedAgents, newAgentMode, selectedAgentAddress, viewMode]);

  useEffect(() => {
    if (viewMode !== "admin") return;
    if (adminDids.length === 0) {
      setSelectedAgentAddress("");
      return;
    }
    const currentExists = adminDids.some(
      (request) => request.subject_wallet_address === selectedAgentAddress,
    );
    if (!currentExists) {
      setSelectedAgentAddress(adminDids[0].subject_wallet_address);
    }
  }, [adminDids, selectedAgentAddress, viewMode]);

  useEffect(() => {
    if (viewMode === "registry" || viewMode === "user") {
      setSelectedAgentAddress("");
      setDidRecord(null);
      return;
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "registry") return;
    if (registryDids.length === 0) {
      setSelectedAgentAddress("");
      return;
    }
    const currentExists = registryDids.some(
      (record) => record.subject_wallet_address === selectedAgentAddress,
    );
    if (!currentExists) {
      setSelectedAgentAddress("");
    }
  }, [registryDids, selectedAgentAddress, viewMode]);

  useEffect(() => {
    if (!providers || !contractAddress || !selectedAgentAddress) {
      setDidRecord(null);
      return;
    }

    fetchDidRecord(providers, contractAddress, selectedAgentAddress)
      .then(async (record) => {
        setDidRecord(record);
        await refreshRequestCollections();
      })
      .catch((error) => {
        console.error("[App] Failed to load DID:", error);
        setDidRecord(null);
      });
  }, [
    contractAddress,
    providers,
    refreshRequestCollections,
    selectedAgentAddress,
    walletAddress,
  ]);

  useEffect(() => {
    if (
      viewMode !== "user" ||
      !walletAddress.trim() ||
      !contractAddress.trim() ||
      !selectedAgentAddress.trim() ||
      !didRecord ||
      customerRequests.some(
        (request) => request.subject_wallet_address === selectedAgentAddress,
      )
    ) {
      return;
    }

    createWalletDidRequest({
      walletAddress,
      subjectWalletAddress: selectedAgentAddress,
      contractAddress,
      networkId: providers?.networkId || "preprod",
      organizationName: didRecord.organization,
      organizationDisclosure: didRecord.organizationDisclosure || "undisclosed",
      requestPayload: {
        agentName: didRecord.agentName || null,
        didDocument: didRecord.didDocument || null,
      },
      requestedDid: didRecord.did,
      onchainRequestTxId: didRecord.txId,
      onchainRequestTxHash: didRecord.txHash,
    })
      .then(async () => {
        await refreshRequestCollections();
      })
      .catch((error) => {
        console.error("[App] Failed to repair user-owned DID request:", error);
      });
  }, [
    contractAddress,
    customerRequests,
    didRecord,
    providers?.networkId,
    refreshRequestCollections,
    selectedAgentAddress,
    viewMode,
    walletAddress,
  ]);

  async function handleDeployed(result: DeployResult) {
    setContractAddress(result.contractAddress);
    setDeployResult(result);
    if (!providers) return;
    const summary = await fetchRegistrySummary(providers, result.contractAddress);
    setRegistrySummary(summary);
    try {
      await saveAdminRegistryDeployment({
        networkId: providers.networkId,
        contractAddress: result.contractAddress,
        deployerWalletAddress: walletAddress,
        deployerShieldedAddress: providers.shieldedAddress,
        registryAdminWalletAddress: walletAddress,
        issuerWalletAddress: walletAddress,
        deployTxId: result.txId,
        deployTxHash: result.txHash,
        initializeTxId: result.initializeTxId,
        initializeTxHash: result.initializeTxHash,
        mode: result.mode,
        metadata: {
          deployedAt: result.deployedAt,
        },
      });
    } catch (error) {
      console.error("[App] Failed to persist registry deployment:", error);
    }
  }

  async function handleRequestDid(payload: {
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }) {
    if (!providers) throw new Error("Wallet providers not ready");
    if (!walletAddress) throw new Error("Connect wallet first");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    const record = await requestDid(providers, {
      contractAddress,
      requesterWalletAddress: walletAddress,
      agentAddress: payload.agentAddress,
      agentName: payload.agentName,
      organization: payload.organization,
      organizationDisclosure: payload.organizationDisclosure,
      didDocument: payload.didDocument,
    });

    setDidRecord(record);
    setSelectedAgentAddress(payload.agentAddress);
    setNewAgentMode(false);
    const summary = await fetchRegistrySummary(providers, contractAddress);
    setRegistrySummary(summary);
    await refreshRequestCollections();
    return record;
  }

  async function refreshAgentRecord(agentAddress: string) {
    if (!providers) throw new Error("Wallet providers not ready");
    const [record, summary] = await Promise.all([
      fetchDidRecord(providers, contractAddress, agentAddress),
      fetchRegistrySummary(providers, contractAddress),
    ]);
    setDidRecord(record);
    setRegistrySummary(summary);
    setSelectedAgentAddress(agentAddress);
    await refreshRequestCollections();
    if (!record) {
      throw new Error("The registry transaction was confirmed but the updated agent record could not be read back from the indexer yet.");
    }
    return record;
  }

  async function waitForRequestIssued(requestId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const request = await getDidRequest(requestId);
      if (request.request_status === "issued") {
        return request;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    throw new Error("The DID was issued on-chain, but the DID service did not reflect the issued request state in time.");
  }

  async function handleRefreshRecord() {
    if (!selectedAgentAddress.trim()) {
      throw new Error("Agent record address is required");
    }
    return refreshAgentRecord(selectedAgentAddress.trim());
  }

  async function handleIssueDid(payload: {
    agentAddress: string;
    didDocument: string;
  }) {
    if (!providers) throw new Error("Wallet providers not ready");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    const issuedRecord = await issueDid(providers, {
      contractAddress,
      agentAddress: payload.agentAddress,
      didDocument: payload.didDocument,
    });

    setDidRecord(issuedRecord);

    if (
      selectedAdminDid &&
      selectedAdminDid.subject_wallet_address === payload.agentAddress &&
      selectedAdminDid.request_status === "pending_admin_review"
    ) {
      let parsedDidDocument: Record<string, unknown>;
      try {
        parsedDidDocument = JSON.parse(payload.didDocument) as Record<string, unknown>;
      } catch {
        throw new Error("The DID was issued on-chain, but the DID document payload could not be parsed for database finalization.");
      }

      await finalizeIssuedDid({
        requestId: selectedAdminDid.id,
        issuerWalletAddress: walletAddress,
        didDocument: parsedDidDocument,
        didRecord: issuedRecord,
      });
      await waitForRequestIssued(selectedAdminDid.id);
    }

    try {
      return await refreshAgentRecord(payload.agentAddress);
    } catch (error) {
      console.warn("[App] Falling back to locally issued DID state while indexer catches up:", error);
      await refreshRequestCollections();
      return issuedRecord;
    }
  }

  async function handleUpdateDid(payload: {
    agentAddress: string;
    didDocument: string;
  }) {
    if (!providers) throw new Error("Wallet providers not ready");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    await updateDid(providers, {
      contractAddress,
      agentAddress: payload.agentAddress,
      didDocument: payload.didDocument,
    });

    return refreshAgentRecord(payload.agentAddress);
  }

  async function handleRevokeDid(payload: {
    agentAddress: string;
    reason: string;
  }) {
    if (!providers) throw new Error("Wallet providers not ready");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    await revokeDid(providers, {
      contractAddress,
      agentAddress: payload.agentAddress,
      reason: payload.reason,
    });

    return refreshAgentRecord(payload.agentAddress);
  }

  useEffect(() => {
    if (!providers || !contractAddress) {
      setRegistrySummary(null);
      return;
    }

    fetchRegistrySummary(providers, contractAddress)
      .then(setRegistrySummary)
      .catch((error) => {
        console.error("[App] Failed to load registry summary:", error);
        setRegistrySummary(null);
      });
  }, [contractAddress, providers]);

  useEffect(() => {
    if (!contractAddress.trim()) {
      setRegistryDids([]);
      return;
    }

    listRegistryDids(contractAddress)
      .then(setRegistryDids)
      .catch((error) => {
        console.error("[App] Failed to load registry DID directory:", error);
        setRegistryDids([]);
      });
  }, [contractAddress, didRecord?.status]);

  useEffect(() => {
    if (!providers || !contractAddress.trim() || !walletAddress.trim()) {
      setRegistryAccess(null);
      return;
    }
    fetchRegistryAccess(providers, contractAddress, walletAddress)
      .then((result) => {
        setRegistryAccess(result);
        if (
          isConfiguredAdminWallet ||
          result?.isIssuer ||
          result?.isRegistryAdmin
        ) {
          setViewMode((current) => current);
        } else {
          setViewMode("user");
        }
      })
      .catch((error) => {
        console.error("[App] Failed to load registry access:", error);
        setRegistryAccess(null);
      });
  }, [providers, contractAddress, walletAddress, isConfiguredAdminWallet]);

  useEffect(() => {
    if (!walletAddress.trim()) {
      setCustomerRequests([]);
      setAdminRequests([]);
      return;
    }
    refreshRequestCollections()
      .catch((error) => {
        console.error("[App] Failed to load customer data:", error);
        setCustomerRequests([]);
        setAdminRequests([]);
      });
  }, [refreshRequestCollections, walletAddress]);

  useEffect(() => {
    if (
      viewMode !== "admin" ||
      !providers ||
      contractAddress.trim() ||
      !walletAddress.trim()
    ) {
      return;
    }

    getLatestAdminRegistryDeployment({
      networkId: providers.networkId,
      deployerWalletAddress: walletAddress,
    })
      .then((deployment) => {
        if (!deployment?.contract_address) return;
        setContractAddress(deployment.contract_address);
        setDeployResult((current) =>
          current ||
          ({
            contractAddress: deployment.contract_address,
            txHash: deployment.deploy_tx_hash || "",
            txId: deployment.deploy_tx_id || undefined,
            initializeTxHash: deployment.initialize_tx_hash || undefined,
            initializeTxId: deployment.initialize_tx_id || undefined,
            mode: deployment.deployment_mode,
            deployedAt: deployment.created_at,
            networkId: deployment.network_id,
          } satisfies DeployResult),
        );
      })
      .catch((error) => {
        console.error("[App] Failed to load latest registry deployment:", error);
      });
  }, [viewMode, providers, walletAddress, contractAddress]);

  function scrollToSection(id: string) {
    if (typeof document === "undefined") return;
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  const sidebarItems: SidebarItem[] =
    viewMode === "admin"
      ? [
          { id: SECTION_IDS.wallet, label: "Wallet", shortLabel: "W" },
          { id: SECTION_IDS.registry, label: "Registry", shortLabel: "R" },
          { id: SECTION_IDS.workflow, label: "Admin Review", shortLabel: "A" },
          { id: SECTION_IDS.issuer, label: "Issuer", shortLabel: "I" },
          { id: "deploy-did-registry", label: "Deploy DID Registry", shortLabel: "D" },
        ]
      : viewMode === "registry"
        ? [
            { id: SECTION_IDS.wallet, label: "Wallet", shortLabel: "W" },
            { id: SECTION_IDS.registry, label: "Registry", shortLabel: "R" },
            { id: SECTION_IDS.registryDirectory, label: "Directory", shortLabel: "D" },
          ]
      : [
          { id: SECTION_IDS.wallet, label: "Wallet", shortLabel: "W" },
          { id: SECTION_IDS.request, label: "Request DID", shortLabel: "D" },
          { id: SECTION_IDS.credentials, label: "Credentials", shortLabel: "C" },
          { id: SECTION_IDS.workflow, label: "Human + MCP", shortLabel: "H" },
        ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div
        className={
          status === "connected"
            ? `lg:grid lg:min-h-screen ${
                sidebarCollapsed
                  ? "lg:grid-cols-[88px_minmax(0,1fr)]"
                  : "lg:grid-cols-[280px_minmax(0,1fr)]"
              }`
            : ""
        }
      >
        {status === "connected" && (
          <aside className="relative border-b border-zinc-800 bg-zinc-950/95 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:absolute lg:-right-3 lg:top-8 lg:flex lg:h-6 lg:w-6 lg:items-center lg:justify-center lg:rounded-full lg:border lg:border-zinc-700 lg:bg-zinc-900 lg:text-xs lg:text-zinc-200 lg:shadow-md lg:transition hover:bg-zinc-800"
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
            <div
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6 lg:flex-col lg:items-stretch lg:justify-start lg:px-4 lg:py-6 ${
                sidebarCollapsed ? "lg:gap-4" : "lg:gap-6"
              }`}
            >
              <div className={`space-y-1 ${sidebarCollapsed ? "lg:text-center" : ""}`}>
                <div className="text-sm font-semibold text-white">
                  {sidebarCollapsed ? "DID" : "DID Console"}
                </div>
                {!sidebarCollapsed && (
                  <div className="text-xs text-zinc-500">
                    {viewMode === "admin"
                      ? "Admin controls and issuer review"
                      : viewMode === "registry"
                        ? "Public registry directory and DID lookup"
                      : "Human dashboard for managed agents"}
                  </div>
                )}
              </div>

              <div
                className={`flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 p-1 ${
                  sidebarCollapsed ? "lg:flex-col lg:rounded-2xl" : "lg:w-full"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setViewMode("user")}
                  className={`rounded-full px-3 py-1.5 text-xs ${
                    viewMode === "user"
                      ? "bg-emerald-600 text-white"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {sidebarCollapsed ? "U" : "User"}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("registry")}
                  className={`rounded-full px-3 py-1.5 text-xs ${
                    viewMode === "registry"
                      ? "bg-sky-600 text-white"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {sidebarCollapsed ? "R" : "Registry"}
                </button>
                {hasAdminAccess && (
                  <button
                    type="button"
                    onClick={() => setViewMode("admin")}
                    className={`rounded-full px-3 py-1.5 text-xs ${
                      viewMode === "admin"
                        ? "bg-amber-600 text-white"
                        : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {sidebarCollapsed ? "A" : "Admin"}
                  </button>
                )}
              </div>

              <nav className="flex w-full flex-wrap gap-2 lg:flex-col">
                {sidebarItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    title={sidebarCollapsed ? item.label : undefined}
                    disabled={
                      (viewMode === "user" &&
                        (item.id === SECTION_IDS.request ||
                          item.id === SECTION_IDS.credentials ||
                          item.id === SECTION_IDS.workflow) &&
                        !userCanOpenAgentFlows) ||
                      (viewMode === "admin" &&
                        item.id === SECTION_IDS.issuer &&
                        !selectedAdminDid)
                    }
                    className={`rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800 ${
                      sidebarCollapsed
                        ? "px-0 py-3 text-center text-xs lg:w-full"
                        : "px-3 py-2 text-left text-sm lg:w-full"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {sidebarCollapsed ? item.shortLabel : item.label}
                  </button>
                ))}
              </nav>

              {viewMode === "user" && !sidebarCollapsed && (
                <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900">
                  <div className="flex items-center justify-between px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setAgentsPanelOpen((current) => !current)}
                      className="flex min-w-0 flex-1 items-center justify-between text-left text-sm text-white"
                    >
                      <span>My Agents</span>
                      <span className="text-xs text-zinc-400">
                        {agentsPanelOpen ? "˄" : "˅"}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Add new Agent"
                      onClick={() => {
                        setNewAgentMode(true);
                        setSelectedAgentAddress("");
                        setAgentsPanelOpen(true);
                        scrollToSection(SECTION_IDS.agents);
                      }}
                      className="ml-3 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-sm text-zinc-200 transition hover:bg-zinc-800"
                    >
                      +
                    </button>
                  </div>
                  {agentsPanelOpen && (
                    <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
                      <p className="text-xs text-zinc-500">
                        Select an agent to make its DID and VC views active.
                      </p>
                      {managedAgents.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          No persisted agents yet in the current DB.
                        </p>
                      ) : (
                        managedAgents.map((agent) => (
                          <button
                            key={agent.subjectWalletAddress}
                            type="button"
                            onClick={() => {
                              setNewAgentMode(false);
                              setSelectedAgentAddress(agent.subjectWalletAddress);
                              scrollToSection(SECTION_IDS.request);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                              selectedAgentAddress === agent.subjectWalletAddress
                                ? "border-emerald-600 bg-emerald-950/30 text-white"
                                : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                            }`}
                          >
                            <div className="font-medium">
                              {agent.agentName || "Unnamed agent"}
                            </div>
                            <div className="mt-1 break-all font-mono text-zinc-500">
                              {agent.subjectWalletAddress}
                            </div>
                            <div className="mt-1 text-zinc-500">
                              {agent.latestStatus}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {viewMode === "admin" && !sidebarCollapsed && (
                <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setAdminDidsPanelOpen((current) => !current)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left text-sm text-white"
                  >
                    <span>DIDs</span>
                    <span className="text-xs text-zinc-400">
                      {adminDidsPanelOpen ? "˄" : "˅"}
                    </span>
                  </button>
                  {adminDidsPanelOpen && (
                    <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
                      <Input
                        value={adminDidSearch}
                        onChange={(e) => setAdminDidSearch(e.target.value)}
                        placeholder="Search DID, wallet, agent..."
                        className="bg-zinc-950 border-zinc-800 text-white"
                      />
                      {filteredAdminDids.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          No pending DIDs found for admin review.
                        </p>
                      ) : (
                        filteredAdminDids.map((request) => (
                          <button
                            key={request.id}
                            type="button"
                            onClick={() => {
                              setSelectedAgentAddress(request.subject_wallet_address);
                              scrollToSection(SECTION_IDS.issuer);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                              selectedAgentAddress === request.subject_wallet_address
                                ? "border-amber-600 bg-amber-950/30 text-white"
                                : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                            }`}
                          >
                            <div className="font-medium">
                              {String(request.request_payload?.agentName || "Unnamed DID")}
                            </div>
                            <div className="mt-1 break-all font-mono text-zinc-500">
                              {request.subject_wallet_address}
                            </div>
                            <div className="mt-1 text-zinc-500">
                              {request.request_status}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {viewMode === "registry" && !sidebarCollapsed && (
                <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setRegistryPanelOpen((current) => !current)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left text-sm text-white"
                  >
                    <span>Registry Agents</span>
                    <span className="text-xs text-zinc-400">
                      {registryPanelOpen ? "˄" : "˅"}
                    </span>
                  </button>
                  {registryPanelOpen && (
                    <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
                      <Input
                        value={registryDidSearch}
                        onChange={(e) => setRegistryDidSearch(e.target.value)}
                        placeholder="Search DID, wallet, agent..."
                        className="bg-zinc-950 border-zinc-800 text-white"
                      />
                      {filteredRegistryDids.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          No public DIDs found for this registry.
                        </p>
                      ) : (
                        filteredRegistryDids.map((record) => (
                          <button
                            key={record.id}
                            type="button"
                            onClick={() => {
                              setSelectedAgentAddress(record.subject_wallet_address);
                              scrollToSection(SECTION_IDS.registryDirectory);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                              selectedAgentAddress === record.subject_wallet_address
                                ? "border-sky-600 bg-sky-950/30 text-white"
                                : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                            }`}
                          >
                            <div className="font-medium">
                              {String(record.public_agent_name || "Unnamed agent")}
                            </div>
                            <div className="mt-1 break-all font-mono text-zinc-500">
                              {record.subject_wallet_address}
                            </div>
                            <div className="mt-1 text-zinc-500">{record.status}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={`grid w-full gap-2 text-xs ${sidebarCollapsed ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-1"}`}>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                  {!sidebarCollapsed && <div className="text-zinc-500">View</div>}
                  <div className={`font-semibold text-white ${sidebarCollapsed ? "text-center" : "mt-1 capitalize"}`}>
                    {sidebarCollapsed ? viewMode.slice(0, 1).toUpperCase() : viewMode}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                  {!sidebarCollapsed && <div className="text-zinc-500">Agents</div>}
                  <div className={`font-semibold text-white ${sidebarCollapsed ? "text-center" : "mt-1"}`}>
                    {managedAgents.length}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}

        <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-8 md:py-10">
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold">
            {versionedAppTitle}
          </h1>
          <p className="text-zinc-400 text-sm md:text-base">
            Connect wallet, register a DID, and track registry state from one
            interface.
          </p>
        </header>

        {viewMode !== "registry" && (
          <section id={SECTION_IDS.wallet} className="scroll-mt-24 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Wallet Access</h2>
                <p className="text-sm text-zinc-500">
                  Connect the human wallet that will operate the registry and customer workflow.
                </p>
              </div>
            </div>
            {status !== "connected" && (
              <div className="flex justify-end">
                <a
                  href="/wallet-testing.html"
                  className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Open Wallet Testing
                </a>
              </div>
            )}
            <WalletPanel
              status={status}
              address={address}
              error={walletError}
              walletName={connectedWalletName}
              connect={connect}
              availableWallets={availableWallets}
              selectedWalletName={selectedWalletName}
              onSelectWallet={setSelectedWalletName}
              pendingRemoteProverApproval={pendingRemoteProverApproval}
              approveRemoteProver={approveRemoteProver}
              declineRemoteProver={declineRemoteProver}
              storageMode={storageMode}
              onSelectStorageMode={setStorageMode}
            />
          </section>
        )}

        {status === "connected" && (
          <div className="space-y-6">
            {walletError && (
              <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
                <strong>⚠️ Wallet Error:</strong> {walletError}
                <details className="mt-2 text-xs">
                  <summary>Show more</summary>
                  <pre className="mt-1 overflow-auto bg-black/30 p-2 rounded">
                    {walletError}
                  </pre>
                </details>
              </div>
            )}

            {!providers && (
              <div className="bg-blue-950/50 border border-blue-800 rounded-lg p-4 text-blue-300 text-sm">
                ⏳ Loading wallet configuration, proof provider, and Midnight services...
              </div>
            )}

            {providers && viewMode === "admin" && (
              <section id={SECTION_IDS.registry} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Registry Setup</h2>
                    <p className="text-sm text-zinc-500">
                      Deploy the registry, track the selected contract, and inspect current chain summary.
                    </p>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 space-y-1">
                  <div>
                    <strong>✅ Network:</strong> {providers.networkId}
                  </div>
                  <div>
                    <strong>🔗 Shielded Address:</strong>{" "}
                    {providers.shieldedAddress.slice(0, 16)}...
                  </div>
                  <div>
                    <strong>📍 Unshielded Address:</strong>{" "}
                    {walletAddress.slice(0, 16)}...
                  </div>
                  {deployResult && (
                    <div>
                      <strong>🧭 Deployment Mode:</strong> {deployResult.mode}
                    </div>
                  )}
                  <div>
                    <strong>📦 ZK Assets:</strong> {providers.zkArtifactsBaseUrl}
                  </div>
                  <div>
                    <strong>🧷 Node:</strong> {providers.nodeUrl}
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
                  <Label htmlFor="contractAddress" className="text-zinc-300">
                    Contract Address
                  </Label>
                  <Input
                    id="contractAddress"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="Paste deployed contract address"
                    className="bg-zinc-950 border-zinc-800 text-white"
                  />
                  <p className="text-xs text-zinc-500">
                    Tip: address auto-fills after deployment. The canonical registry
                    state now lives on Midnight Preprod and is read back through the
                    official indexer provider.
                  </p>
                </div>

                {registrySummary && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <div className="text-zinc-500 text-xs">Requests</div>
                      <div>{registrySummary.totalRequests}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-xs">Active DIDs</div>
                      <div>{registrySummary.totalActiveDids}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-xs">Revoked</div>
                      <div>{registrySummary.totalRevokedDids}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-xs">Last Updated</div>
                      <div>{new Date(registrySummary.lastUpdatedAt).toLocaleString()}</div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {viewMode === "user" && (
              <section id={SECTION_IDS.agents} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">My Agents</h2>
                    <p className="text-sm text-zinc-500">
                      One human account can manage multiple agent wallets and multiple DIDs. The sidebar list is the canonical selector.
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setNewAgentMode(true);
                        setSelectedAgentAddress("");
                        scrollToSection(SECTION_IDS.request);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      New Agent
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        handleRefreshRecord().catch((error) => {
                          console.error("[App] Failed to refresh DID:", error);
                        });
                      }}
                      disabled={!providers || !contractAddress.trim() || !selectedAgentAddress.trim()}
                      className="bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700"
                    >
                      Refresh Record
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {viewMode === "registry" && (
              <section
                id={SECTION_IDS.registryDirectory}
                className="scroll-mt-24 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Registry Directory</h2>
                    <p className="text-sm text-zinc-500">
                      Public information for all agents associated with the selected registry contract.
                    </p>
                  </div>
                </div>
                {!contractAddress.trim() ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    Select or paste a contract address first.
                  </div>
                ) : filteredRegistryDids.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    No public DID records were found for this registry yet.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filteredRegistryDids.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() =>
                            setSelectedAgentAddress(record.subject_wallet_address)
                          }
                          className={`rounded-xl border p-5 text-left transition ${
                            selectedAgentAddress === record.subject_wallet_address
                              ? "border-sky-600 bg-sky-950/30 text-white"
                              : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold">
                                {record.public_agent_name || "Unnamed agent"}
                              </div>
                              <div className="mt-1 text-xs text-zinc-400">
                                {record.organization_disclosure === "disclosed"
                                  ? record.organization_name || "No organization"
                                  : "Organization undisclosed"}
                              </div>
                            </div>
                            <span className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300">
                              {record.status}
                            </span>
                          </div>
                          <div className="mt-4 break-all font-mono text-xs text-zinc-500">
                            {record.subject_wallet_address}
                          </div>
                          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                            <span className="block max-w-full truncate font-mono">
                              {record.did}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {selectedRegistryDid ? (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                          <div className="text-zinc-500 text-xs">Selected Public Agent</div>
                          <div className="mt-1 font-semibold text-white">
                            {selectedRegistryDid.public_agent_name || "Unnamed agent"}
                          </div>
                          <div className="mt-1 break-all font-mono text-xs text-zinc-400">
                            {selectedRegistryDid.subject_wallet_address}
                          </div>
                        </div>
                        <DidDisplay record={didRecord} />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                        Select an agent card to inspect its public DID details.
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {viewMode === "user" && (
              <section id={SECTION_IDS.request} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Agent DID</h2>
                    <p className="text-sm text-zinc-500">
                      Create or update a requester-authored DID payload for any agent wallet this human manages, then inspect the resulting DID state.
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                  <div className="text-zinc-500 text-xs">Active Agent Context</div>
                  <div className="mt-1 font-semibold text-white">
                    {activeAgentSummary?.agentName ||
                      didRecord?.agentName ||
                      (selectedAgentAddress.trim() ? "Selected Agent" : "No agent selected")}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-zinc-400">
                    {selectedAgentAddress || "Choose an agent from the sidebar or click New Agent."}
                  </div>
                </div>
                {!userCanOpenAgentFlows ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    Select an agent from the sidebar or click `+` in `My Agents` before requesting a DID.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <RequestForm
                      contractAddress={contractAddress}
                      walletAddress={walletAddress}
                      initialAgentAddress={
                        newAgentMode ? "" : selectedAgentAddress
                      }
                      onRequest={handleRequestDid}
                    />
                    <DidDisplay record={didRecord} />
                  </div>
                )}
              </section>
            )}

            {viewMode === "admin" && selectedAdminDid && didRecord && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Selected DID Record</h2>
                    <p className="text-sm text-zinc-500">
                      Admin can inspect the currently selected subject before issuing, updating, or revoking.
                    </p>
                  </div>
                </div>
                <DidDisplay record={didRecord} />
              </section>
            )}

            {viewMode === "admin" && (
              <section id={SECTION_IDS.issuer} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Issuer Operations</h2>
                    <p className="text-sm text-zinc-500">
                      Review the selected agent and execute issue, update, or revoke on-chain.
                    </p>
                  </div>
                </div>
                {!selectedAdminDid ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    Select a DID from the admin `DIDs` sidebar list before using issuer operations.
                  </div>
                ) : (
                  <IssuerPanel
                    contractAddress={contractAddress}
                    targetAgentAddress={selectedAgentAddress}
                    record={didRecord}
                    onIssue={handleIssueDid}
                    onUpdate={handleUpdateDid}
                    onRevoke={handleRevokeDid}
                  />
                )}
              </section>
            )}

            {viewMode === "user" && (
              <section id={SECTION_IDS.credentials} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Credentials</h2>
                    <p className="text-sm text-zinc-500">
                      Build and verify disclosure bundles for the currently active DID.
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                  <div className="text-zinc-500 text-xs">Credential Subject</div>
                  <div className="mt-1 font-semibold text-white">
                    {activeAgentSummary?.agentName || didRecord?.agentName || "No agent selected"}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-zinc-400">
                    {selectedAgentAddress || "Choose an agent from the sidebar first."}
                  </div>
                </div>
                {!activeAgentSummary ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    Select an existing agent from the sidebar to inspect credentials and VC disclosure for that DID.
                  </div>
                ) : (
                  <VcPanel record={didRecord} />
                )}
              </section>
            )}

            {providers && viewMode !== "registry" && (
              <section id={SECTION_IDS.workflow} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {viewMode === "admin" ? "Admin Review Queue" : "Human + MCP Operations"}
                    </h2>
                    <p className="text-sm text-zinc-500">
                      {viewMode === "admin"
                        ? "Admin-only queue for approved requests that are ready to be issued on-chain."
                        : "Customer account, MCP keys, request intake, and human approval for multiple managed agents."}
                    </p>
                  </div>
                </div>
                {viewMode === "user" && !userCanOpenAgentFlows ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
                    Select an agent from `My Agents` or click `+` before using the request and MCP workflow.
                  </div>
                ) : (
                  <WorkflowPanel
                    providers={providers}
                    walletAddress={walletAddress}
                    contractAddress={contractAddress}
                    mode={viewMode}
                    onIssueOnChain={handleIssueDid}
                  />
                )}
              </section>
            )}

            {providers && viewMode === "admin" && (
              <section className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Owner Vault</h2>
                    <p className="text-sm text-zinc-500">
                      Export and restore the local admin secret used by issuer-only operations.
                    </p>
                  </div>
                </div>
                <OwnerVaultPanel
                  providers={providers}
                  contractAddress={contractAddress}
                />
              </section>
            )}

            {providers && viewMode === "admin" && (
              <section id="deploy-did-registry" className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Deploy DID Registry</h2>
                    <p className="text-sm text-zinc-500">
                      Deploy a fresh registry contract or redeploy the current admin-controlled instance.
                    </p>
                  </div>
                </div>
                <DeployPanel
                  providers={providers}
                  onDeployed={handleDeployed}
                />
              </section>
            )}
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
