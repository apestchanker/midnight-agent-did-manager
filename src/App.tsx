import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TokenGatingPanel } from "./components/TokenGatingPanel";
import type { DidRecord, DeployResult, RegistryAccess, RegistrySummary } from "./types/did";
import type {
  DidRequestRow,
  LogEntry,
  MidnightProofVerificationResult,
  RegistryDidRow,
  UnifiedVerifiablePresentation,
} from "./types/service";
import { APP_VERSION } from "./lib/version";
import {
  getSavedContractAddress,
  getSavedDeployment,
} from "./lib/didContract";
import { UnifiedRegistryAPI } from "./lib/registry";
import {
  requestDidWithSync,
  revokeDidWithSync,
  updateDidWithSync,
} from "./lib/did/app-api";
import { deriveSubjectNonceFromSeed } from "./lib/did/private-state";
import {
  createWalletDidRequest,
  fetchBackendLogs,
  fetchMcpLogs,
  finalizeIssuedDid,
  getCustomerByWallet,
  getLatestAdminRegistryDeployment,
  listDidRequests,
  listRegistryDids,
  saveAdminRegistryDeployment,
  verifyUnifiedVPRequest,
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

function registryJoinErrorMessage(error: unknown, contractAddress: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const isVerifierKeyMismatch =
    message.includes("mismatched verifier keys") ||
    message.includes("undefined or have mismatched verifier keys");
  const isStateLayoutMismatch = message.includes("invalid alignment supplied");

  if (isVerifierKeyMismatch || isStateLayoutMismatch) {
    return [
      `Cannot use contract ${contractAddress} with this app build.`,
      "The deployed registry was compiled with a different DID contract artifact, so the app cannot join it or build an admin issue transaction.",
      "Create and approve a new DID request against the latest registry deployment, or use the matching legacy app build for this contract.",
    ].join(" ");
  }

  return message;
}

export default function App() {
  function createSystemAgentId() {
    return `agent-${crypto.randomUUID().toLowerCase()}`;
  }
  type ViewMode = "user" | "admin" | "registry";
  type ActiveMainSection =
    | typeof SECTION_IDS.wallet
    | typeof SECTION_IDS.agents
    | typeof SECTION_IDS.registry
    | typeof SECTION_IDS.registryDirectory
    | typeof SECTION_IDS.request
    | typeof SECTION_IDS.issuer
    | typeof SECTION_IDS.credentials
    | typeof SECTION_IDS.workflow
    | "admin-subscriptions"
    | "admin-tokens"
    | "admin-logs"
    | "owner-vault"
    | "deploy-did-registry";
  type SidebarItem = {
    id: string;
    label: string;
    shortLabel: string;
  };
  type SettingsSection = "overview" | "subscriptions" | "mcp" | "human";
  type AgentSummary = {
    key: string;
    agentId: string;
    contractAddress: string;
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
  const LAST_AGENT_SELECTION_KEY = "did-registry:last-agent-selection:v1";
  const STORAGE_MODE_KEY = "did-registry:storage-mode:v1";
  const [storageMode, setStorageMode] = useState<StorageMode>(() => {
    if (typeof window === "undefined") return "app_local";
    const saved = window.localStorage.getItem(STORAGE_MODE_KEY);
    return saved === "sdk_level" ? "sdk_level" : "app_local";
  });
  const {
    status,
    api,
    address,
    providers,
    proofService,
    error: walletError,
    connect,
    availableWallets,
    selectedWalletName,
    setSelectedWalletName,
    connectedWalletName,
  } = useWallet(storageMode);

  useEffect(() => {
    document.title = versionedAppTitle;
  }, [versionedAppTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_MODE_KEY, storageMode);
  }, [storageMode]);

  const [contractAddress, setContractAddress] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedAgentAddress, setSelectedAgentAddress] = useState("");
  const [selectedAgentKey, setSelectedAgentKey] = useState("");
  const [didRecord, setDidRecord] = useState<DidRecord | null>(null);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [tokenAPI, setTokenAPI] = useState<UnifiedRegistryAPI | null>(null);
  const [registryAccess, setRegistryAccess] = useState<RegistryAccess | null>(null);
  const [customerRequests, setCustomerRequests] = useState<DidRequestRow[]>([]);
  const [adminRequests, setAdminRequests] = useState<DidRequestRow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("user");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(true);
  const [adminDidsPanelOpen, setAdminDidsPanelOpen] = useState(true);
  const [adminDidSearch, setAdminDidSearch] = useState("");
  const [selectedAdminRequestId, setSelectedAdminRequestId] = useState("");
  const [registryPanelOpen, setRegistryPanelOpen] = useState(true);
  const [selectedRegistryDidId, setSelectedRegistryDidId] = useState("");
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("overview");
  const [activeMainSection, setActiveMainSection] =
    useState<ActiveMainSection>(SECTION_IDS.wallet);
  const [registryDidSearch, setRegistryDidSearch] = useState("");
  const [newAgentMode, setNewAgentMode] = useState(false);
  const [registrySummary, setRegistrySummary] = useState<RegistrySummary | null>(
    null,
  );
  const [registryDids, setRegistryDids] = useState<RegistryDidRow[]>([]);
  const [registryApi, setRegistryApi] = useState<UnifiedRegistryAPI | null>(null);
  const [registryApiError, setRegistryApiError] = useState("");
  const [registryProofPackageJson, setRegistryProofPackageJson] = useState("");
  const [registryProofVerification, setRegistryProofVerification] =
    useState<MidnightProofVerificationResult | null>(null);
  const [registryProofMessage, setRegistryProofMessage] = useState("");
  const [registryProofBusy, setRegistryProofBusy] = useState(false);
  const [registryProofReceipt, setRegistryProofReceipt] = useState<{
    hash: string;
    verifiedAt: string;
  } | null>(null);
  const [customerQuotaTotal, setCustomerQuotaTotal] = useState(0);
  const [backendLogs, setBackendLogs] = useState<LogEntry[]>([]);
  const [mcpLogs, setMcpLogs] = useState<LogEntry[]>([]);
  const [logsError, setLogsError] = useState("");
  const agentCarouselRef = useRef<HTMLDivElement | null>(null);
  const adminDidCarouselRef = useRef<HTMLDivElement | null>(null);
  const registryCarouselRef = useRef<HTMLDivElement | null>(null);
  const customerRegisteredAgentCount = useMemo(
    () =>
      new Set(
        customerRequests
          .filter((request) => request.request_status === "issued")
          .map((request) => `${request.contract_address}:${request.agent_id}`),
      ).size,
    [customerRequests],
  );

  const walletAddress = useMemo(() => address || "", [address]);
  const isConfiguredAdminWallet = useMemo(() => {
    if (!configuredAdminShieldedAddress || !providers?.shieldedAddress) return false;
    return (
      providers.shieldedAddress.trim().toLowerCase() ===
      configuredAdminShieldedAddress
    );
  }, [configuredAdminShieldedAddress, providers?.shieldedAddress]);
  const hasLocalOwnerDeployment = Boolean(
    deployResult?.contractAddress &&
      contractAddress.trim() &&
      deployResult.contractAddress.trim() === contractAddress.trim() &&
      deployResult.ownerDerivation,
  );
  const canBootstrapRegistry = Boolean(providers && !contractAddress.trim());
  const hasAdminAccess = Boolean(
    isConfiguredAdminWallet ||
      registryAccess?.isIssuer ||
      registryAccess?.isRegistryAdmin ||
      hasLocalOwnerDeployment ||
      canBootstrapRegistry,
  );
  const managedAgents = useMemo<AgentSummary[]>(() => {
    const latestByAgent = new Map<string, DidRequestRow>();
    for (const request of customerRequests) {
      const agentKey = [
        request.contract_address,
        request.agent_id,
      ].join(":");
      const current = latestByAgent.get(agentKey);
      if (!current) {
        latestByAgent.set(agentKey, request);
        continue;
      }
      if (
        new Date(request.updated_at).getTime() >=
        new Date(current.updated_at).getTime()
      ) {
        latestByAgent.set(agentKey, request);
      }
    }
    return Array.from(latestByAgent.entries())
      .map(([key, request]) => ({
        key,
        agentId: request.agent_id || "",
        contractAddress: request.contract_address,
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
      managedAgents.find((agent) => agent.key === selectedAgentKey) ||
      managedAgents.find(
        (agent) =>
          agent.agentId === selectedAgentId &&
          agent.contractAddress === contractAddress,
      ) ||
      managedAgents.find((agent) => agent.agentId === selectedAgentId) ||
      null,
    [contractAddress, managedAgents, selectedAgentId, selectedAgentKey],
  );
  const userCanOpenAgentFlows = Boolean(activeAgentSummary || newAgentMode);
  const adminDids = useMemo(() => {
    return [...adminRequests].sort(
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
      adminDids.find((request) => request.id === selectedAdminRequestId) || null,
    [adminDids, selectedAdminRequestId],
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
      registryDids.find((record) => record.id === selectedRegistryDidId) ||
      registryDids.find((record) => (record.agent_id || record.subject_wallet_address) === selectedAgentId) || null,
    [registryDids, selectedAgentId, selectedRegistryDidId],
  );

  const refreshRequestCollections = useCallback(async () => {
    if (!walletAddress.trim()) {
      setCustomerRequests([]);
      setAdminRequests([]);
      setCustomerQuotaTotal(0);
      return;
    }

    const [customer, pendingAdmin] = await Promise.all([
      getCustomerByWallet(walletAddress),
      listDidRequests({ status: "pending_admin_review" }),
    ]);

    if (customer?.customer?.id) {
      setCustomerQuotaTotal(
        customer.subscriptions.reduce(
          (sum, subscription) => sum + Number(subscription.did_quota_total || 0),
          0,
        ),
      );
      setCustomerRequests(
        await listDidRequests({ customerId: customer.customer.id }),
      );
    } else {
      setCustomerRequests([]);
      setCustomerQuotaTotal(0);
    }
    setAdminRequests(pendingAdmin);
  }, [walletAddress]);

  useEffect(() => {
    if (!(status === "connected" && viewMode === "admin" && activeMainSection === "admin-logs")) {
      return;
    }

    let cancelled = false;

    const refreshLogs = async () => {
      try {
        const [backend, mcp] = await Promise.all([
          fetchBackendLogs(200),
          fetchMcpLogs(200),
        ]);
        if (cancelled) return;
        setBackendLogs(backend.entries);
        setMcpLogs(mcp.entries);
        setLogsError("");
      } catch (error) {
        if (cancelled) return;
        setLogsError(error instanceof Error ? error.message : String(error));
      }
    };

    void refreshLogs();
    const timer = window.setInterval(() => {
      void refreshLogs();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeMainSection, status, viewMode]);

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
    const viewedAgentSelection =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_AGENT_SELECTION_KEY)
        : "";
    if (viewedContract || savedAddress) setContractAddress(viewedContract || savedAddress);
    if (viewedAgent) setSelectedAgentAddress(viewedAgent);
    if (viewedAgentSelection) setSelectedAgentKey(viewedAgentSelection);
    if (savedDeployment) setDeployResult(savedDeployment);
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedAgentKey("");
    }
  }, [walletAddress]);

  // tokenAPI is now an alias to the unified registry contract (same contract handles both gating + DID)
  useEffect(() => {
    if (registryApi) {
      setTokenAPI(registryApi);
    } else {
      setTokenAPI(null);
    }
  }, [registryApi]);

  useEffect(() => {
    if (viewMode === "user") {
      setActiveMainSection(SECTION_IDS.wallet);
      return;
    }
    if (viewMode === "admin") {
      setActiveMainSection(SECTION_IDS.registry);
      return;
    }
    setActiveMainSection(SECTION_IDS.registryDirectory);
  }, [viewMode]);

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
    if (typeof window === "undefined") return;
    if (selectedAgentKey.trim()) {
      window.localStorage.setItem(LAST_AGENT_SELECTION_KEY, selectedAgentKey.trim());
    }
  }, [selectedAgentKey]);

  useEffect(() => {
    if (viewMode !== "user") return;
    if (newAgentMode) return;
    if (managedAgents.length === 0) {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedAgentKey("");
      return;
    }
    const currentExists = managedAgents.some(
      (agent) => agent.key === selectedAgentKey,
    );
    if (!currentExists) {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedAgentKey("");
    }
  }, [managedAgents, newAgentMode, selectedAgentKey, viewMode]);

  useEffect(() => {
    if (viewMode !== "admin") return;
    if (adminDids.length === 0) {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedAdminRequestId("");
      return;
    }
    const currentExists = adminDids.some((request) => request.id === selectedAdminRequestId);
    if (!currentExists) {
      setSelectedAdminRequestId(adminDids[0].id);
      setSelectedAgentId(adminDids[0].agent_id || "");
      setSelectedAgentAddress(adminDids[0].subject_wallet_address);
      setContractAddress(adminDids[0].contract_address);
    }
  }, [adminDids, selectedAdminRequestId, viewMode]);

  useEffect(() => {
    if (viewMode === "registry" || viewMode === "user") {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedAgentKey("");
      setDidRecord(null);
      return;
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "registry") return;
    if (registryDids.length === 0) {
      setSelectedAgentId("");
      setSelectedAgentAddress("");
      setSelectedRegistryDidId("");
      return;
    }
    const currentExists = registryDids.some(
      (record) => record.id === selectedRegistryDidId,
    );
    if (!currentExists) {
      setSelectedRegistryDidId(registryDids[0].id);
      setSelectedAgentId(registryDids[0].agent_id || "");
      setSelectedAgentAddress(registryDids[0].subject_wallet_address);
    }
  }, [registryDids, selectedRegistryDidId, viewMode]);

  useEffect(() => {
    if (viewMode !== "user") return;
    setDidRecord(null);
  }, [contractAddress, selectedAgentId, selectedAgentKey, viewMode]);

  useEffect(() => {
    if (!providers || !contractAddress.trim()) {
      setRegistryApi(null);
      setRegistryApiError("");
      return;
    }

    let cancelled = false;
    UnifiedRegistryAPI.join(providers, contractAddress)
      .then((api) => {
        if (!cancelled) {
          setRegistryApi(api);
          setRegistryApiError("");
        }
      })
      .catch((error) => {
        console.error("[App] Failed to join registry API:", error);
        if (!cancelled) {
          setRegistryApi(null);
          setRegistryApiError(registryJoinErrorMessage(error, contractAddress));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contractAddress, providers]);

  useEffect(() => {
    if (!registryApi || !selectedAgentId) {
      setDidRecord(null);
      return;
    }

    const subscription = registryApi.agentRecord$(selectedAgentId, selectedAgentAddress).subscribe({
      next: async (record) => {
        setDidRecord(record);
        await refreshRequestCollections();
      },
      error: (error) => {
        console.error("[App] Failed to load DID:", error);
        setDidRecord(null);
      },
    });

    return () => subscription.unsubscribe();
  }, [refreshRequestCollections, registryApi, selectedAgentAddress, selectedAgentId, walletAddress]);

  useEffect(() => {
    if (
      viewMode !== "user" ||
      !walletAddress.trim() ||
      !contractAddress.trim() ||
      !selectedAgentId.trim() ||
      !didRecord ||
      customerRequests.some(
        (request) => request.agent_id === selectedAgentId,
      )
    ) {
      return;
    }

    createWalletDidRequest({
      walletAddress,
      agentId: selectedAgentId,
      subjectWalletAddress: selectedAgentAddress || didRecord.subjectWalletAddress || walletAddress,
      contractAddress,
      networkId: providers?.networkId || "preprod",
      organizationName: didRecord.organization,
      organizationDisclosure: didRecord.organizationDisclosure || "undisclosed",
      requestPayload: {
        agentId: selectedAgentId,
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
    selectedAgentId,
    viewMode,
    walletAddress,
  ]);

  async function handleDeployed(result: DeployResult) {
    setContractAddress(result.contractAddress);
    setDeployResult(result);
    if (!providers) return;
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
          ownerDerivation: result.ownerDerivation,
        },
      });
    } catch (error) {
      console.error("[App] Failed to persist registry deployment:", error);
    }
  }

  async function handleRequestDid(payload: {
    agentId?: string;
    subjectWalletAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }) {
    if (!registryApi) throw new Error("Wallet providers not ready");
    if (!walletAddress) throw new Error("Connect wallet first");
    if (!contractAddress.trim()) throw new Error("Contract address is required");
    const agentId = (payload.agentId || createSystemAgentId()).trim().toLowerCase();

    const record = await requestDidWithSync(registryApi, {
      requesterWalletAddress: walletAddress,
      agentId,
      subjectWalletAddress: payload.subjectWalletAddress,
      agentName: payload.agentName,
      organization: payload.organization,
      organizationDisclosure: payload.organizationDisclosure,
      didDocument: payload.didDocument,
    });

    setDidRecord(record);
    setSelectedAgentId(agentId);
    setSelectedAgentAddress(payload.subjectWalletAddress);
    setNewAgentMode(false);
    await refreshRequestCollections();
    return record;
  }

  async function refreshAgentRecord(
    agentId: string,
    subjectWalletAddress?: string,
    apiOverride?: UnifiedRegistryAPI,
  ) {
    const activeRegistryApi = apiOverride || registryApi;
    if (!activeRegistryApi) throw new Error("Wallet providers not ready");
    const [record, summary] = await Promise.all([
      activeRegistryApi.fetchDidRecord(agentId, subjectWalletAddress),
      activeRegistryApi.fetchRegistrySummary(),
    ]);
    setDidRecord(record);
    setRegistrySummary(summary);
    setSelectedAgentId(agentId);
    if (subjectWalletAddress) setSelectedAgentAddress(subjectWalletAddress);
    await refreshRequestCollections();
    if (!record) {
      throw new Error("The registry transaction was confirmed but the updated agent record could not be read back from the indexer yet.");
    }
    return record;
  }

  async function handleRefreshRecord() {
    if (!selectedAgentId.trim()) {
      throw new Error("Agent ID is required");
    }
    return refreshAgentRecord(selectedAgentId.trim(), selectedAgentAddress.trim());
  }

  async function handleIssueDid(payload: {
    requestId?: string;
    contractAddress?: string;
    agentId: string;
    subjectWalletAddress?: string;
    didDocument: string;
  }) {
    if (!providers) throw new Error("Wallet providers not ready");
    const targetContractAddress = (
      payload.contractAddress ||
      selectedAdminDid?.contract_address ||
      contractAddress
    ).trim();
    if (!targetContractAddress)
      throw new Error("Contract address is required");
    const request =
      (payload.requestId
        ? adminRequests.find((item) => item.id === payload.requestId)
        : null) ||
      (selectedAdminDid?.id === payload.requestId ? selectedAdminDid : null);
    const parsedDidDocument = JSON.parse(payload.didDocument) as Record<string, unknown>;
    if (request && !request.onchain_request_tx_id) {
      throw new Error(
        "This request has not been registered on-chain by the human owner yet. Approve it from the human approvals flow first.",
      );
    }

    let activeRegistryApi: UnifiedRegistryAPI;
    try {
      activeRegistryApi =
        registryApi?.contractAddress === targetContractAddress
          ? registryApi
          : await UnifiedRegistryAPI.join(providers, targetContractAddress);
      setRegistryApiError("");
    } catch (error) {
      const message = registryJoinErrorMessage(error, targetContractAddress);
      setRegistryApiError(message);
      throw new Error(message);
    }
    if (activeRegistryApi !== registryApi) {
      setRegistryApi(activeRegistryApi);
    }
    if (contractAddress !== targetContractAddress) {
      setContractAddress(targetContractAddress);
    }

    const didKeyHex = request?.requested_did?.split(":").pop();
    const issuedRecord = await activeRegistryApi.issueDid({
      contractAddress: activeRegistryApi.contractAddress,
      agentId: payload.agentId,
      subjectWalletAddress: payload.subjectWalletAddress,
      didDocument: payload.didDocument,
      didKeyHex,
    });

    setDidRecord(issuedRecord);

    if (request) {
      await finalizeIssuedDid({
        requestId: request.id,
        issuerWalletAddress: walletAddress,
        didDocument: parsedDidDocument,
        didRecord: issuedRecord,
      });
    }

    try {
      return await refreshAgentRecord(
        payload.agentId,
        payload.subjectWalletAddress,
        activeRegistryApi,
      );
    } catch (error) {
      console.warn("[App] Falling back to locally issued DID state while indexer catches up:", error);
      await refreshRequestCollections();
      return issuedRecord;
    }
  }

  async function handleApproveDidRequestOnChain(payload: {
    requestId: string;
    agentId: string;
    requesterWalletAddress: string;
    subjectWalletAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }) {
    if (!registryApi) throw new Error("Wallet providers not ready");
    if (!walletAddress) throw new Error("Connect wallet first");
    if (!contractAddress.trim()) throw new Error("Contract address is required");

    const subjectNonce = await deriveSubjectNonceFromSeed(
      [
        "didmn:mcp-request-slot:v1",
        contractAddress.trim(),
        payload.requestId,
        payload.agentId,
        payload.subjectWalletAddress,
      ].join(":"),
    );

    // Single atomic TX: consumes token credit AND registers DID in one ZK circuit.
    // The gated_self_register_did circuit verifies token ownership on-chain — no cross-contract
    // commitment needed because both token gating and DID logic live in the same contract.
    const record = await registryApi.gatedSelfRegisterDid({
      subjectNonce,
      agentId: payload.agentId,
      subjectWalletAddress: payload.subjectWalletAddress,
      agentName: payload.agentName,
      organization: payload.organization,
      organizationDisclosure: payload.organizationDisclosure,
      didDocument: payload.didDocument,
    });

    setDidRecord(record);
    setSelectedAgentId(payload.agentId);
    setSelectedAgentAddress(payload.subjectWalletAddress);
    return record;
  }

  async function handleUpdateDid(payload: {
    agentId: string;
    subjectWalletAddress?: string;
    didDocument: string;
  }) {
    if (!registryApi) throw new Error("Wallet providers not ready");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    await updateDidWithSync(registryApi, {
      contractAddress: registryApi.contractAddress,
      agentId: payload.agentId,
      subjectWalletAddress: payload.subjectWalletAddress,
      didDocument: payload.didDocument,
    });

    return refreshAgentRecord(payload.agentId, payload.subjectWalletAddress);
  }

  async function handleRevokeDid(payload: {
    agentId: string;
    subjectWalletAddress?: string;
    reason: string;
  }) {
    if (!registryApi) throw new Error("Wallet providers not ready");
    if (!contractAddress.trim())
      throw new Error("Contract address is required");

    await revokeDidWithSync(registryApi, {
      contractAddress: registryApi.contractAddress,
      agentId: payload.agentId,
      subjectWalletAddress: payload.subjectWalletAddress,
      reason: payload.reason,
    });

    return refreshAgentRecord(payload.agentId, payload.subjectWalletAddress);
  }

  async function handleVerifyRegistryProof() {
    setRegistryProofBusy(true);
    setRegistryProofMessage("");
    setRegistryProofVerification(null);
    setRegistryProofReceipt(null);
    try {
      const parsed = JSON.parse(registryProofPackageJson) as UnifiedVerifiablePresentation;
      // Validate: must be a UnifiedVerifiablePresentation (proof.type check)
      if (!parsed?.proof?.type || parsed.proof.type !== "MidnightNativeOwnershipProof2024") {
        setRegistryProofMessage(
          "Legacy format not accepted. Please use a UnifiedVerifiablePresentation (proof.type: MidnightNativeOwnershipProof2024).",
        );
        return;
      }
      const result = await verifyUnifiedVPRequest(parsed);
      const verifiedAt = new Date().toISOString();
      const receiptPayload = JSON.stringify({
        vp: parsed,
        result,
        verifiedAt,
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(receiptPayload),
      );
      const receiptHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      setRegistryProofVerification(result);
      setRegistryProofReceipt({
        hash: receiptHash,
        verifiedAt,
      });
      setRegistryProofMessage(
        result.valid
          ? `Proof verification succeeded with status ${result.status}.`
          : `Proof verification failed with status ${result.status}.`,
      );
    } catch (error) {
      setRegistryProofMessage(
        error instanceof Error ? error.message : "Proof verification failed",
      );
    } finally {
      setRegistryProofBusy(false);
    }
  }

  useEffect(() => {
    if (!registryApi) {
      setRegistrySummary(null);
      return;
    }

    const subscription = registryApi.registrySummary$.subscribe({
      next: setRegistrySummary,
      error: (error) => {
        console.error("[App] Failed to load registry summary:", error);
        setRegistrySummary(null);
      },
    });

    return () => subscription.unsubscribe();
  }, [registryApi]);

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
    if (!registryApi || !walletAddress.trim() || !providers) {
      setRegistryAccess(null);
      return;
    }
    const subscription = registryApi.access$(providers.shieldedCoinPublicKeyHex).subscribe({
      next: (result) => {
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
      },
      error: (error) => {
        console.error("[App] Failed to load registry access:", error);
        setRegistryAccess(null);
      },
    });

    return () => subscription.unsubscribe();
  }, [registryApi, walletAddress, isConfiguredAdminWallet, providers]);

  useEffect(() => {
    if (!walletAddress.trim()) {
      setCustomerRequests([]);
      setAdminRequests([]);
      return;
    }

    let cancelled = false;
    const loadRequests = async () => {
      try {
        await refreshRequestCollections();
      } catch (error) {
        if (cancelled) return;
        console.error("[App] Failed to load customer data:", error);
        setCustomerRequests([]);
        setAdminRequests([]);
      }
    };

    void loadRequests();
    const timer = window.setInterval(() => {
      void loadRequests();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshRequestCollections, walletAddress]);

  useEffect(() => {
    if (
      (viewMode !== "admin" && viewMode !== "registry") ||
      !providers ||
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
        if (
          viewMode === "registry" ||
          !contractAddress.trim() ||
          contractAddress !== deployment.contract_address
        ) {
          setContractAddress(deployment.contract_address);
        }
        setDeployResult((current) =>
          current && current.contractAddress === deployment.contract_address
            ? current
            : ({
                contractAddress: deployment.contract_address,
                txHash: deployment.deploy_tx_hash || "",
                txId: deployment.deploy_tx_id || undefined,
                initializeTxHash: deployment.initialize_tx_hash || undefined,
                initializeTxId: deployment.initialize_tx_id || undefined,
                mode: deployment.deployment_mode,
                deployedAt: deployment.created_at,
                networkId: deployment.network_id,
                ownerDerivation:
                  deployment.metadata &&
                  typeof deployment.metadata === "object" &&
                  "ownerDerivation" in deployment.metadata
                    ? (deployment.metadata.ownerDerivation as DeployResult["ownerDerivation"])
                    : undefined,
              } satisfies DeployResult),
        );
      })
      .catch((error) => {
        console.error("[App] Failed to load latest registry deployment:", error);
      });
  }, [viewMode, providers, walletAddress, contractAddress]);

  const sidebarItems: SidebarItem[] =
    viewMode === "admin"
      ? [
          { id: SECTION_IDS.wallet, label: "Wallet", shortLabel: "W" },
          { id: SECTION_IDS.registry, label: "Registry", shortLabel: "R" },
          { id: "admin-subscriptions", label: "DID Quota", shortLabel: "S" },
          { id: "admin-tokens", label: "Action Credits", shortLabel: "T" },
          { id: SECTION_IDS.workflow, label: "Review Queue", shortLabel: "Q" },
          { id: SECTION_IDS.issuer, label: "Issuer", shortLabel: "I" },
          { id: "admin-logs", label: "Logs", shortLabel: "L" },
          { id: "owner-vault", label: "Controller", shortLabel: "C" },
          { id: "deploy-did-registry", label: "Deploy DID Registry", shortLabel: "D" },
        ]
      : viewMode === "registry"
        ? [{ id: SECTION_IDS.registryDirectory, label: "Directory", shortLabel: "D" }]
      : [{ id: SECTION_IDS.wallet, label: "Wallet", shortLabel: "W" }];

  const activeSettingsLabel =
    {
      overview: "Overview",
      subscriptions: "Subscriptions",
      mcp: "MCP Keys",
      human: "Approvals",
    }[settingsSection];

  function scrollAgentCarousel(direction: "left" | "right") {
    const node = agentCarouselRef.current;
    if (!node) return;
    const step = node.clientWidth;
    node.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  }

  function scrollAdminDidCarousel(direction: "left" | "right") {
    const node = adminDidCarouselRef.current;
    if (!node) return;
    const step = node.clientWidth;
    node.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  }

  function scrollRegistryCarousel(direction: "left" | "right") {
    const node = registryCarouselRef.current;
    if (!node) return;
    const step = node.clientWidth;
    node.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div
        className={
          status === "connected"
            ? `lg:grid lg:min-h-screen ${
                sidebarCollapsed
                  ? "lg:grid-cols-[88px_minmax(0,1fr)]"
                  : "lg:grid-cols-[360px_minmax(0,1fr)]"
              }`
            : ""
        }
      >
        {status === "connected" && (
          <aside className="relative overflow-hidden border-b border-zinc-800 bg-zinc-950/95 lg:sticky lg:top-0 lg:h-screen lg:max-h-screen lg:border-b-0 lg:border-r">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:absolute lg:-right-3 lg:top-8 lg:flex lg:h-6 lg:w-6 lg:items-center lg:justify-center lg:rounded-full lg:border lg:border-zinc-700 lg:bg-zinc-900 lg:text-xs lg:text-zinc-200 lg:shadow-md lg:transition hover:bg-zinc-800"
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
            <div
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6 lg:h-full lg:min-h-0 lg:flex-col lg:items-stretch lg:justify-start lg:overflow-y-auto lg:overscroll-contain lg:px-4 lg:py-6 ${
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
                    onClick={() => setActiveMainSection(item.id as ActiveMainSection)}
                    title={sidebarCollapsed ? item.label : undefined}
                    disabled={
                      (viewMode === "user" &&
                        (item.id === SECTION_IDS.request ||
                          item.id === SECTION_IDS.credentials) &&
                        !userCanOpenAgentFlows) ||
                      (viewMode === "admin" &&
                        item.id === SECTION_IDS.issuer &&
                        !selectedAdminDid)
                    }
                    className={`rounded-xl border text-zinc-200 transition ${
                      activeMainSection === item.id
                        ? "border-emerald-600 bg-emerald-950/30 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    } ${
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
                <>
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
                        setSelectedAgentId("");
                        setSelectedAgentAddress("");
                        setSelectedAgentKey("");
                        setAgentsPanelOpen(true);
                        setActiveMainSection(SECTION_IDS.request);
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
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveMainSection(SECTION_IDS.request)}
                              disabled={!userCanOpenAgentFlows}
                              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                                activeMainSection === SECTION_IDS.request
                                  ? "border-emerald-600 bg-emerald-950/30 text-white"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                              } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              Agent DID
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveMainSection(SECTION_IDS.credentials)}
                              disabled={!activeAgentSummary}
                              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                                activeMainSection === SECTION_IDS.credentials
                                  ? "border-emerald-600 bg-emerald-950/30 text-white"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                              } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              Credentials
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => scrollAgentCarousel("left")}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                              aria-label="Scroll agents left"
                            >
                              {"<"}
                            </button>
                            <div
                              ref={agentCarouselRef}
                              className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto pb-1 scroll-smooth"
                            >
                              <div className="flex w-full">
                              {managedAgents.map((agent) => (
                                <button
                                  key={agent.key}
                                  type="button"
                                  onClick={() => {
                                    setNewAgentMode(false);
                                    setSelectedAgentKey(agent.key);
                                    setSelectedAgentId(agent.agentId);
                                    setSelectedAgentAddress(agent.subjectWalletAddress);
                                    setContractAddress(agent.contractAddress);
                                    setActiveMainSection(SECTION_IDS.request);
                                  }}
                                  className={`w-full shrink-0 snap-start rounded-lg border px-3 py-2 text-left text-xs transition ${
                                    selectedAgentId === agent.agentId &&
                                    contractAddress === agent.contractAddress
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
                                  <div className="mt-1 break-all text-zinc-500">
                                    {agent.contractAddress}
                                  </div>
                                  <div className="mt-1 text-zinc-500">
                                    {agent.latestStatus}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                            <button
                              type="button"
                              onClick={() => scrollAgentCarousel("right")}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                              aria-label="Scroll agents right"
                            >
                              {">"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setSettingsPanelOpen((current) => !current)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left text-sm text-white"
                  >
                    <span>Settings</span>
                    <span className="text-xs text-zinc-400">
                      {settingsPanelOpen ? "˄" : "˅"}
                    </span>
                  </button>
                  {settingsPanelOpen && (
                    <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
                      {(
                        [
                          ["overview", "Overview"],
                          ["subscriptions", "Subscriptions"],
                          ["mcp", "MCP Keys"],
                          ["human", "Approvals"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setSettingsSection(id);
                            setActiveMainSection(SECTION_IDS.workflow);
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                            settingsSection === id
                              ? "border-emerald-600 bg-emerald-950/30 text-white"
                              : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                </>
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
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => scrollAdminDidCarousel("left")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                            aria-label="Scroll admin DIDs left"
                          >
                            {"<"}
                          </button>
                          <div
                            ref={adminDidCarouselRef}
                            className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto pb-1 scroll-smooth"
                          >
                            <div className="flex w-full">
                              {filteredAdminDids.map((request) => (
                                <button
                                  key={request.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedAdminRequestId(request.id);
                                    setSelectedAgentId(request.agent_id || "");
                                    setSelectedAgentAddress(request.subject_wallet_address);
                                    setContractAddress(request.contract_address);
                                    setActiveMainSection(SECTION_IDS.issuer);
                                  }}
                                  className={`w-full shrink-0 snap-start rounded-lg border px-3 py-2 text-left text-xs transition ${
                                    selectedAdminRequestId === request.id
                                      ? "border-emerald-600 bg-emerald-950/30 text-white"
                                      : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                                  }`}
                                >
                                  <div className="font-medium">
                                    {String(request.request_payload?.agentName || "Unnamed DID")}
                                  </div>
                                  <div className="mt-1 break-all font-mono text-zinc-500">
                                    {request.subject_wallet_address}
                                  </div>
                                  <div className="mt-1 break-all text-zinc-500">
                                    {request.requested_did || "pending DID"}
                                  </div>
                                  <div className="mt-1 text-zinc-500">
                                    {request.request_status}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => scrollAdminDidCarousel("right")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                            aria-label="Scroll admin DIDs right"
                          >
                            {">"}
                          </button>
                        </div>
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
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => scrollRegistryCarousel("left")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                            aria-label="Scroll registry agents left"
                          >
                            {"<"}
                          </button>
                          <div
                            ref={registryCarouselRef}
                            className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto pb-1 scroll-smooth"
                          >
                            <div className="flex w-full">
                              {filteredRegistryDids.map((record) => (
                                <button
                                  key={record.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRegistryDidId(record.id);
                                    setSelectedAgentId(record.agent_id || "");
                                    setSelectedAgentAddress(record.subject_wallet_address);
                                    setActiveMainSection(SECTION_IDS.registryDirectory);
                                  }}
                                  className={`w-full shrink-0 snap-start rounded-lg border px-3 py-2 text-left text-xs transition ${
                                    selectedRegistryDidId === record.id
                                      ? "border-emerald-600 bg-emerald-950/30 text-white"
                                      : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                                  }`}
                                >
                                  <div className="font-medium">
                                    {String(record.public_agent_name || "Unnamed agent")}
                                  </div>
                                  <div className="mt-1 break-all font-mono text-zinc-500">
                                    {record.subject_wallet_address}
                                  </div>
                                  <div className="mt-1 break-all text-zinc-500">
                                    {record.did}
                                  </div>
                                  <div className="mt-1 text-zinc-500">{record.status}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => scrollRegistryCarousel("right")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:bg-zinc-800"
                            aria-label="Scroll registry agents right"
                          >
                            {">"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10 lg:h-screen lg:overflow-y-auto">
        <header className="sticky top-0 z-10 -mx-4 border-b border-zinc-800 bg-zinc-950/95 px-4 pb-4 pt-1 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold">
                {versionedAppTitle}
              </h1>
              <p className="text-zinc-400 text-sm md:text-base">
                Connect wallet, register a DID, and track registry state from one
                interface.
              </p>
            </div>
            {status === "connected" && (
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <div className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">
                  <span className="text-zinc-500">View:</span>{" "}
                  <span className="font-semibold capitalize text-white">{viewMode}</span>
                </div>
                {viewMode === "user" && (
                  <div className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">
                    <span className="text-zinc-500">Agents:</span>{" "}
                    <span className="font-semibold text-white">
                      {customerRegisteredAgentCount} / {customerQuotaTotal}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {viewMode !== "registry" && activeMainSection === SECTION_IDS.wallet && (
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
              storageMode={storageMode}
              onSelectStorageMode={setStorageMode}
              proofService={proofService}
            />
          </section>
        )}

        {status === "connected" && (
          <div className="mt-8 space-y-6">
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

            {providers && viewMode === "admin" && activeMainSection === SECTION_IDS.registry && (
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

            {viewMode === "user" && activeMainSection === SECTION_IDS.agents && (
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
                        setSelectedAgentId("");
                        setSelectedAgentAddress("");
                        setActiveMainSection(SECTION_IDS.request);
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

            {viewMode === "registry" && activeMainSection === SECTION_IDS.registryDirectory && (
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
                          onClick={() => {
                            setSelectedAgentId(record.agent_id || "");
                            setSelectedAgentAddress(record.subject_wallet_address);
                          }}
                          className={`rounded-xl border p-5 text-left transition ${
                            selectedAgentId === record.agent_id
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
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300 space-y-4">
                          <div>
                            <h3 className="text-base font-semibold text-white">Verify Proof</h3>
                            <p className="text-sm text-zinc-500">
                              Paste the UnifiedVerifiablePresentation JSON emitted by the wallet approval flow (proof.type: MidnightNativeOwnershipProof2024).
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="registryProofPackageJson" className="text-zinc-300">
                              Proof Verification Package JSON
                            </Label>
                            <textarea
                              id="registryProofPackageJson"
                              value={registryProofPackageJson}
                              onChange={(e) => setRegistryProofPackageJson(e.target.value)}
                              className="min-h-[24rem] w-full rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-white"
                              placeholder='{"@context":["https://www.w3.org/ns/credentials/v2"],"type":["VerifiablePresentation"],"holder":"did:midnight:...","verifiableCredential":["eyJ..."],"proof":{"type":"MidnightNativeOwnershipProof2024","created":"2026-01-01T00:00:00.000Z","verificationMethod":"midnight:wallet:did:midnight:...","proofPurpose":"authentication","scheme":"midnight-native-ownership-v1","proofValue":"0x...","publicInputsHash":"0x...","coinPublicKey":"mn1q...","challenge":"...","bundleCommitment":"0x...","holderBindingCommitment":"0x...","disclosedScopes":["ownership"]}}'
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <Button
                              type="button"
                              onClick={handleVerifyRegistryProof}
                              disabled={registryProofBusy}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                              {registryProofBusy ? "Verifying..." : "Verify Proof"}
                            </Button>
                            {registryProofMessage && (
                              <div className="text-xs text-zinc-300">{registryProofMessage}</div>
                            )}
                          </div>
                          {registryProofVerification && (
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-1">
                              {(() => {
                                const isNativeProof =
                                  registryProofVerification.status === "native_proof_verified" ||
                                  registryProofVerification.status === "native_proof_unverified" ||
                                  registryProofVerification.status === "boundary_verified_only";
                                return (
                                  <>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">Valid:</span>
                                <span className={registryProofVerification.valid ? "text-emerald-300" : "text-red-300"}>
                                  {String(registryProofVerification.valid)}
                                </span>
                              </div>
                              <div><span className="text-zinc-500">Status:</span> {registryProofVerification.status}</div>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">DID Active:</span>
                                <span className={registryProofVerification.didActive ? "text-emerald-300" : "text-red-300"}>
                                  {String(registryProofVerification.didActive)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">Issuer Credentials Verified:</span>
                                <span className={registryProofVerification.issuerCredentialsVerified ? "text-emerald-300" : "text-red-300"}>
                                  {String(registryProofVerification.issuerCredentialsVerified)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">Request Integrity Verified:</span>
                                <span className={registryProofVerification.requestIntegrityVerified ? "text-emerald-300" : "text-red-300"}>
                                  {String(registryProofVerification.requestIntegrityVerified)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">Proof Envelope Verified:</span>
                                {isNativeProof ? (
                                  <span className="text-zinc-400">n/a</span>
                                ) : (
                                  <span className={(registryProofVerification.proofEnvelopeVerified ?? false) ? "text-emerald-300" : "text-red-300"}>
                                    {String(registryProofVerification.proofEnvelopeVerified ?? false)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">
                                  {isNativeProof
                                    ? "Native Statement Check Verified:"
                                    : "Cryptographic Proof Verified:"}
                                </span>
                                <span className={registryProofVerification.cryptographicProofVerified ? "text-emerald-300" : "text-red-300"}>
                                  {String(registryProofVerification.cryptographicProofVerified)}
                                </span>
                              </div>
                              {isNativeProof && (
                                <div className="text-zinc-500">
                                  This confirms the native ownership statement boundary and circuit check for the submitted proof package. It does not claim canonical verifier-side validation of the external proof blob as an independently parsed artifact.
                                </div>
                              )}
                                  </>
                                );
                              })()}
                              {registryProofReceipt && (
                                <div className="pt-2 space-y-1">
                                  <div className="text-zinc-500">Verification Receipt</div>
                                  <div><span className="text-zinc-500">Hash:</span> <span className="font-mono break-all">{registryProofReceipt.hash}</span></div>
                                  <div><span className="text-zinc-500">Timestamp:</span> {new Date(registryProofReceipt.verifiedAt).toLocaleString()}</div>
                                </div>
                              )}
                              {(registryProofVerification.warnings?.length ?? 0) > 0 && (
                                <div className="pt-2">
                                  <div className="text-zinc-500">Warnings:</div>
                                  <pre className="whitespace-pre-wrap break-words">{registryProofVerification.warnings.join("\n")}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
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

            {viewMode === "user" && activeMainSection === SECTION_IDS.request && (
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
                      initialAgentId={newAgentMode ? "" : activeAgentSummary?.agentId}
                      initialAgentAddress={
                        newAgentMode ? "" : selectedAgentAddress
                      }
                      onRequest={handleRequestDid}
                    />
                    <div className="space-y-4">
                      <DidDisplay record={didRecord} />
                    </div>
                  </div>
                )}
              </section>
            )}

            {viewMode === "admin" && activeMainSection === SECTION_IDS.issuer && selectedAdminDid && didRecord && (
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

            {viewMode === "admin" && activeMainSection === SECTION_IDS.issuer && (
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
                    networkId={providers?.networkId}
                    requestId={selectedAdminDid.id}
                    targetAgentId={selectedAdminDid.agent_id || ""}
                    targetSubjectWalletAddress={selectedAdminDid.subject_wallet_address}
                    record={didRecord}
                    onIssue={handleIssueDid}
                    onUpdate={handleUpdateDid}
                    onRevoke={handleRevokeDid}
                  />
                )}
                {registryApiError && (
                  <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
                    {registryApiError}
                  </div>
                )}
              </section>
            )}

            {viewMode === "user" && activeMainSection === SECTION_IDS.credentials && (
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
                  <VcPanel
                    record={didRecord}
                    connectedApi={providers?.connectedAPI ?? api}
                    walletAddress={walletAddress}
                    providers={providers}
                  />
                )}
              </section>
            )}

            {providers &&
              viewMode !== "registry" &&
              (activeMainSection === SECTION_IDS.workflow ||
                activeMainSection === "admin-subscriptions") && (
              <section id={SECTION_IDS.workflow} className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {viewMode === "admin"
                        ? activeMainSection === "admin-subscriptions"
                          ? "Subscriptions"
                          : "Review Queue"
                        : activeSettingsLabel}
                    </h2>
                    <p className="text-sm text-zinc-500">
                      {viewMode === "admin"
                        ? activeMainSection === "admin-subscriptions"
                          ? "Admin controls for customer quota assignment and subscription management."
                          : "Admin-only queue for approved requests that are ready to be issued on-chain."
                        : "Customer account controls for subscriptions, MCP keys, and human approvals."}
                    </p>
                  </div>
                </div>
                {registryApiError && (
                  <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
                    {registryApiError}
                  </div>
                )}
                <WorkflowPanel
                  providers={providers}
                  connectedApi={providers?.connectedAPI ?? api}
                  walletAddress={walletAddress}
                  contractAddress={contractAddress}
                  mode={viewMode}
                  onIssueOnChain={handleIssueDid}
                  onApproveOnChain={handleApproveDidRequestOnChain}
                  activeSection={
                    viewMode === "user"
                      ? settingsSection
                      : activeMainSection === "admin-subscriptions"
                        ? "subscriptions"
                        : "admin"
                  }
                  onActiveSectionChange={
                    viewMode === "user" ? (section) => setSettingsSection(section as SettingsSection) : undefined
                  }
                  showSectionNav={false}
                  showHeader={false}
                />
              </section>
            )}

            {providers && viewMode === "admin" && activeMainSection === "admin-tokens" && (
              <section id="admin-tokens" className="scroll-mt-24 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Shielded Action Credits</h2>
                  <p className="text-sm text-zinc-500">
                    On-chain shielded tokens that gate DID registry operations. Each gated action
                    (self-register, update, grant/revoke role, revoke DID) consumes one credit.
                    Separate from the off-chain DID issuance quota shown in{" "}
                    <strong>DID Quota</strong>.
                  </p>
                </div>
                {registryApiError && (
                  <div className="rounded-md border border-red-800 bg-red-950/40 p-3">
                    <p className="text-xs text-red-300">{registryApiError}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Make sure the contract address field (top of the page) contains the unified registry address from the Deploy tab.
                    </p>
                  </div>
                )}
                <TokenGatingPanel
                  providers={providers}
                  tokenAPI={tokenAPI}
                  isAdmin={isConfiguredAdminWallet}
                />
              </section>
            )}

            {viewMode === "admin" && activeMainSection === "admin-logs" && (
              <section id="admin-logs" className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Logs</h2>
                    <p className="text-sm text-zinc-500">
                      Live process output for the local backend API and MCP HTTP server.
                    </p>
                  </div>
                </div>
                {logsError && (
                  <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                    {logsError}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {(
                    [
                      ["Backend", backendLogs],
                      ["MCP", mcpLogs],
                    ] as const
                  ).map(([label, entries]) => (
                    <div
                      key={label}
                      className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                    >
                      <div className="border-b border-zinc-800 px-4 py-3">
                        <h3 className="text-sm font-semibold text-white">{label} Logs</h3>
                      </div>
                      <div className="max-h-[32rem] space-y-2 overflow-y-auto px-4 py-4 font-mono text-xs">
                        {entries.length === 0 ? (
                          <div className="text-zinc-500">No log entries captured yet.</div>
                        ) : (
                          entries.map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                                <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                                <span className="rounded-full border border-zinc-700 px-2 py-0.5 uppercase tracking-wide">
                                  {entry.level}
                                </span>
                                <span>{entry.scope}</span>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap break-words text-zinc-200">
                                {entry.message}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {providers && viewMode === "admin" && activeMainSection === "owner-vault" && (
              <section id="owner-vault" className="scroll-mt-24 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Registry Controller</h2>
                    <p className="text-sm text-zinc-500">
                      Inspect the v2 controller-bound registry state. Owner vault backups are no longer used.
                    </p>
                  </div>
                </div>
                <OwnerVaultPanel
                  providers={providers}
                  contractAddress={contractAddress}
                />
              </section>
            )}

            {providers && viewMode === "admin" && activeMainSection === "deploy-did-registry" && (
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
