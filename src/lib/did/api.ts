import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { from, map, of, shareReplay, switchMap, type Observable } from "rxjs";
import type { AppProviders } from "../../../lib/providers";
import { fromHex, toHex } from "../../../lib/wallet-bridge";
import type {
  DidRecord,
  IssueDidInput,
  RegistryAccess,
  RegistrySummary,
  RevokeDidInput,
  UpdateDidInput,
} from "../../types/did";
import { getDidMetadata, mergeDidMetadata } from "./cache";
import {
  createAgentKey,
  createDidCommitment,
  createDidIdentifier,
  createDocumentCommitment,
  createLifecycleProofCommitment,
  createProofCommitment,
  createRequestCommitment,
  createRevocationCommitment,
  disclosureFlag,
  disclosureFromValue,
  encodeFixedBytes,
  decodeFixedBytes,
} from "./commitments";
import {
  bigintishToNumber,
  deriveRegistryAccess,
  deriveRegistrySummary,
  mapLookupByHexKey,
  statusCodeToDidStatus,
  toRecordHex,
} from "./ledger";
import { getContractRuntime, extractContractAddress } from "./runtime";
import { createDeploymentOwnerPrivateState, ensureOwnerPrivateState, getOwnerVaultStatus } from "./vault";
import { getPersistedDidState } from "./service-sync";
import {
  MANAGED_CONTRACT_BASE_PATH,
  OWNER_PRIVATE_STATE_ID,
  type DeployTransactionMetadata,
} from "./types";

type TxResult = { public: { txHash: string; txId?: string } };

async function primeWalletSession(providers: AppProviders): Promise<void> {
  await providers.connectedAPI.getConfiguration();
  await providers.connectedAPI.getShieldedAddresses();
  await providers.connectedAPI.getUnshieldedAddress();
}

export class DidRegistryAPI {
  private constructor(
    readonly providers: AppProviders,
    readonly contractAddress: string,
    private readonly module: Awaited<ReturnType<typeof getContractRuntime>>["module"],
    private readonly compiledContract: Awaited<ReturnType<typeof getContractRuntime>>["compiledContract"],
    private readonly contract: {
      callTx: Record<string, unknown>;
    },
  ) {
    this.ledgerState$ = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress as never, { type: "latest" })
      .pipe(
        map((state) => this.module.ledger((state as { data: unknown }).data)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    this.registrySummary$ = this.ledgerState$.pipe(
      map((ledgerState) =>
        deriveRegistrySummary(ledgerState, this.contractAddress, this.providers.networkId),
      ),
    );
  }

  readonly ledgerState$: Observable<Record<string, unknown>>;
  readonly registrySummary$: Observable<RegistrySummary>;

  static async deploy(providers: AppProviders): Promise<DidRegistryAPI> {
    await primeWalletSession(providers);
    const ownerPrivateState = createDeploymentOwnerPrivateState(providers);
    const ownerPublicKey = ownerPrivateState.issuerPublicKeyHex
      ? fromHex(ownerPrivateState.issuerPublicKeyHex)
      : ownerPrivateState.issuerSecret;
    const { module, compiledContract } = await getContractRuntime(MANAGED_CONTRACT_BASE_PATH);
    const deployed = await deployContract(providers as never, {
      compiledContract: compiledContract as never,
      args: [ownerPublicKey],
      privateStateId: OWNER_PRIVATE_STATE_ID,
      initialPrivateState: ownerPrivateState,
    });

    const contractAddress = extractContractAddress(deployed);
    if (!contractAddress) {
      throw new Error(
        "Deployment succeeded but the contract address could not be derived from the Midnight SDK response.",
      );
    }

    providers.privateStateProvider.setContractAddress(contractAddress as never);
    await providers.privateStateProvider.set(OWNER_PRIVATE_STATE_ID, ownerPrivateState);

    return new DidRegistryAPI(
      providers,
      contractAddress,
      module,
      compiledContract,
      deployed as { callTx: Record<string, unknown> },
    );
  }

  static async join(providers: AppProviders, contractAddress: string): Promise<DidRegistryAPI> {
    const { module, compiledContract } = await getContractRuntime(MANAGED_CONTRACT_BASE_PATH);
    const contract = await findDeployedContract(providers as never, {
      compiledContract: compiledContract as never,
      contractAddress: contractAddress as never,
      privateStateId: OWNER_PRIVATE_STATE_ID,
    });

    return new DidRegistryAPI(
      providers,
      contractAddress,
      module,
      compiledContract,
      contract as { callTx: Record<string, unknown> },
    );
  }

  private async getOwnerContract() {
    const ownerPrivateState = await ensureOwnerPrivateState(this.providers, this.contractAddress);
    return findDeployedContract(this.providers as never, {
      compiledContract: this.compiledContract as never,
      contractAddress: this.contractAddress as never,
      privateStateId: OWNER_PRIVATE_STATE_ID,
      initialPrivateState: ownerPrivateState,
    }) as Promise<{ callTx: Record<string, unknown> }>;
  }

  async requestDid(input: {
    requesterWalletAddress: string;
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }): Promise<DidRecord> {
    const agentKey = await createAgentKey(input.agentAddress);
    const requestCommitment = await createRequestCommitment({
      ...input,
      contractAddress: this.contractAddress,
    });
    const proofCommitment = await createProofCommitment({
      ...input,
      contractAddress: this.contractAddress,
      networkId: this.providers.networkId,
    });
    const organizationLabel = encodeFixedBytes(input.organization || "", 64);
    const organizationDisclosure = disclosureFlag(input.organizationDisclosure);

    const tx = await (this.contract.callTx.request_did as (
      agentKeyArg: Uint8Array,
      requestCommitmentArg: Uint8Array,
      proofCommitmentArg: Uint8Array,
      organizationLabelArg: Uint8Array,
      organizationDisclosureArg: bigint,
    ) => Promise<TxResult>)(agentKey, requestCommitment, proofCommitment, organizationLabel, organizationDisclosure);

    const now = new Date().toISOString();
    return {
      agentAddress: input.agentAddress,
      agentName: input.agentName,
      organization:
        input.organizationDisclosure === "disclosed"
          ? input.organization
          : undefined,
      organizationDisclosure: input.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      agentKeyHex: toHex(agentKey),
      requestCommitmentHex: toHex(requestCommitment),
      proofCommitmentHex: toHex(proofCommitment),
      status: "pending_issuance",
      proofStatus: "verified",
      txStatus: "confirmed",
      createdAt: now,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async issueDid(input: IssueDidInput): Promise<DidRecord> {
    const ownerContract = await this.getOwnerContract();
    const agentKey = await createAgentKey(input.agentAddress);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const didCommitment = await createDidCommitment({
      did,
      contractAddress: this.contractAddress,
      agentAddress: input.agentAddress,
    });
    const documentCommitment = await createDocumentCommitment(input.didDocument);
    const proofCommitment = await createLifecycleProofCommitment({
      action: "issue_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentAddress: input.agentAddress,
      did,
      didDocument: input.didDocument,
    });
    const existing = getDidMetadata(this.contractAddress, input.agentAddress);
    const organization = existing?.organization;
    const organizationDisclosureValue = existing?.organizationDisclosure || "undisclosed";
    const organizationLabel = encodeFixedBytes(
      organizationDisclosureValue === "disclosed" ? organization || "" : "",
      64,
    );
    const organizationDisclosure = disclosureFlag(organizationDisclosureValue);

    const tx = await (ownerContract.callTx.issue_did as (
      agentKeyArg: Uint8Array,
      didCommitmentArg: Uint8Array,
      documentCommitmentArg: Uint8Array,
      proofCommitmentArg: Uint8Array,
      organizationLabelArg: Uint8Array,
      organizationDisclosureArg: bigint,
    ) => Promise<TxResult>)(agentKey, didCommitment, documentCommitment, proofCommitment, organizationLabel, organizationDisclosure);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentAddress, {
      updatedAt: now,
      issuedAt: now,
      revokedAt: undefined,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      didDocument: input.didDocument.trim(),
      didCommitmentHex: toHex(didCommitment),
      documentHashHex: toHex(documentCommitment),
      proofCommitmentHex: toHex(proofCommitment),
    });

    return {
      agentAddress: input.agentAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      agentKeyHex,
      did,
      didHashHex: toHex(didCommitment),
      didCommitmentHex: toHex(didCommitment),
      documentHashHex: toHex(documentCommitment),
      requestCommitmentHex: cached.requestCommitmentHex,
      proofCommitmentHex: toHex(proofCommitment),
      status: "active",
      proofStatus: "verified",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      issuedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async updateDid(input: UpdateDidInput): Promise<DidRecord> {
    const ownerContract = await this.getOwnerContract();
    const agentKey = await createAgentKey(input.agentAddress);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const didCommitment = await createDidCommitment({
      did,
      contractAddress: this.contractAddress,
      agentAddress: input.agentAddress,
    });
    const documentCommitment = await createDocumentCommitment(input.didDocument);
    const proofCommitment = await createLifecycleProofCommitment({
      action: "update_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentAddress: input.agentAddress,
      did,
      didDocument: input.didDocument,
    });
    const existing = getDidMetadata(this.contractAddress, input.agentAddress);
    const organization = existing?.organization;
    const organizationDisclosureValue = existing?.organizationDisclosure || "undisclosed";
    const organizationLabel = encodeFixedBytes(
      organizationDisclosureValue === "disclosed" ? organization || "" : "",
      64,
    );
    const organizationDisclosure = disclosureFlag(organizationDisclosureValue);

    const tx = await (ownerContract.callTx.update_did as (
      agentKeyArg: Uint8Array,
      didCommitmentArg: Uint8Array,
      documentCommitmentArg: Uint8Array,
      proofCommitmentArg: Uint8Array,
      organizationLabelArg: Uint8Array,
      organizationDisclosureArg: bigint,
    ) => Promise<TxResult>)(agentKey, didCommitment, documentCommitment, proofCommitment, organizationLabel, organizationDisclosure);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentAddress, {
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      didDocument: input.didDocument.trim(),
      didCommitmentHex: toHex(didCommitment),
      documentHashHex: toHex(documentCommitment),
      proofCommitmentHex: toHex(proofCommitment),
    });

    return {
      agentAddress: input.agentAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      agentKeyHex,
      did,
      didHashHex: toHex(didCommitment),
      didCommitmentHex: toHex(didCommitment),
      documentHashHex: toHex(documentCommitment),
      requestCommitmentHex: cached.requestCommitmentHex,
      proofCommitmentHex: toHex(proofCommitment),
      revocationCommitmentHex: cached.revocationCommitmentHex,
      status: "active",
      proofStatus: "verified",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      issuedAt: cached.issuedAt || now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async revokeDid(input: RevokeDidInput): Promise<DidRecord> {
    const ownerContract = await this.getOwnerContract();
    const agentKey = await createAgentKey(input.agentAddress);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const revocationCommitment = await createRevocationCommitment({
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentAddress: input.agentAddress,
      did,
      reason: input.reason,
    });

    const tx = await (ownerContract.callTx.revoke_did as (
      agentKeyArg: Uint8Array,
      revocationCommitmentArg: Uint8Array,
    ) => Promise<TxResult>)(agentKey, revocationCommitment);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentAddress, {
      updatedAt: now,
      revokedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      revocationCommitmentHex: toHex(revocationCommitment),
    });

    return {
      agentAddress: input.agentAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: cached.didDocument,
      agentKeyHex,
      did,
      didHashHex: cached.didCommitmentHex,
      didCommitmentHex: cached.didCommitmentHex,
      documentHashHex: cached.documentHashHex,
      requestCommitmentHex: cached.requestCommitmentHex,
      proofCommitmentHex: cached.proofCommitmentHex,
      revocationCommitmentHex: toHex(revocationCommitment),
      status: "revoked",
      proofStatus: cached.proofCommitmentHex ? "verified" : "not_requested",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      issuedAt: cached.issuedAt,
      revokedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async fetchDidRecord(agentAddress: string): Promise<DidRecord | null> {
    if (!this.contractAddress.trim() || !agentAddress.trim()) return null;

    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return null;

    return this.buildDidRecordFromLedger(
      this.module.ledger((state as { data: unknown }).data),
      agentAddress,
    );
  }

  async fetchRegistrySummary(): Promise<RegistrySummary | null> {
    if (!this.contractAddress.trim()) return null;
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return null;
    return deriveRegistrySummary(
      this.module.ledger((state as { data: unknown }).data),
      this.contractAddress,
      this.providers.networkId,
    );
  }

  async fetchRegistryAccess(walletAddress: string): Promise<RegistryAccess | null> {
    if (!this.contractAddress.trim() || !walletAddress.trim()) return null;
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return null;
    return deriveRegistryAccess(
      this.module.ledger((state as { data: unknown }).data),
      this.contractAddress,
      walletAddress,
      toHex,
    );
  }

  ownerVaultStatus$(): Observable<Awaited<ReturnType<typeof getOwnerVaultStatus>>> {
    return this.ledgerState$.pipe(
      switchMap(() => from(getOwnerVaultStatus(this.providers, this.contractAddress))),
    );
  }

  access$(walletAddress: string): Observable<RegistryAccess | null> {
    if (!walletAddress.trim()) return of(null);
    return this.ledgerState$.pipe(
      switchMap((ledgerState) =>
        from(
          deriveRegistryAccess(
            ledgerState,
            this.contractAddress,
            walletAddress,
            toHex,
          ),
        ),
      ),
    );
  }

  agentRecord$(agentAddress: string): Observable<DidRecord | null> {
    if (!agentAddress.trim()) return of(null);
    return this.ledgerState$.pipe(
      switchMap((ledgerState) => from(this.buildDidRecordFromLedger(ledgerState, agentAddress))),
    );
  }

  private async buildDidRecordFromLedger(
    ledgerState: Record<string, unknown>,
    agentAddress: string,
  ): Promise<DidRecord | null> {
    const agentKey = await createAgentKey(agentAddress);
    const agentKeyHex = toHex(agentKey);
    const statusCode = bigintishToNumber(
      mapLookupByHexKey(ledgerState.status_by_agent, agentKeyHex, fromHex, toHex),
    );
    if (!statusCode) return null;

    const didCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.did_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const documentHashHex = toRecordHex(
      mapLookupByHexKey(ledgerState.document_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const requestCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.request_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const proofCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.proof_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const revocationCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.revocation_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const organizationLabel = decodeFixedBytes(
      mapLookupByHexKey(ledgerState.organization_labels, agentKeyHex, fromHex, toHex),
    );
    const organizationDisclosure = disclosureFromValue(
      mapLookupByHexKey(ledgerState.organization_disclosures, agentKeyHex, fromHex, toHex),
    );
    const cached = getDidMetadata(this.contractAddress, agentAddress);
    let persisted: Awaited<ReturnType<typeof getPersistedDidState>> | null = null;
    try {
      persisted = await getPersistedDidState({
        contractAddress: this.contractAddress,
        walletAddress: agentAddress,
      });
    } catch {
      persisted = null;
    }
    const persistedRequest = persisted?.request || null;
    const persistedRecord = persisted?.record || null;
    const did = didCommitmentHex
      ? await createDidIdentifier(this.providers.networkId, this.contractAddress, agentKeyHex)
      : undefined;

    return {
      agentAddress,
      agentName:
        (typeof persistedRequest?.request_payload?.agentName === "string"
          ? persistedRequest.request_payload.agentName
          : undefined) || cached?.agentName,
      organization:
        organizationDisclosure === "disclosed"
          ? organizationLabel || persistedRecord?.organization_name || cached?.organization
          : undefined,
      organizationDisclosure,
      didDocument:
        (persistedRecord?.did_document
          ? JSON.stringify(persistedRecord.did_document, null, 2)
          : typeof persistedRequest?.request_payload?.didDocument === "string"
            ? persistedRequest.request_payload.didDocument
            : undefined) || cached?.didDocument,
      agentKeyHex,
      did,
      didHashHex: didCommitmentHex,
      didCommitmentHex,
      documentHashHex: documentHashHex || cached?.documentHashHex,
      requestCommitmentHex:
        requestCommitmentHex || cached?.requestCommitmentHex || undefined,
      proofCommitmentHex:
        proofCommitmentHex || cached?.proofCommitmentHex || undefined,
      revocationCommitmentHex:
        revocationCommitmentHex || cached?.revocationCommitmentHex,
      status: statusCodeToDidStatus(statusCode),
      proofStatus: proofCommitmentHex ? "verified" : "not_requested",
      txStatus: "confirmed",
      createdAt: persistedRequest?.created_at || persistedRecord?.created_at || cached?.createdAt || new Date().toISOString(),
      updatedAt: persistedRecord?.updated_at || persistedRequest?.updated_at || cached?.updatedAt || new Date().toISOString(),
      issuedAt:
        statusCode >= 2
          ? persistedRecord?.issued_at || cached?.issuedAt || new Date().toISOString()
          : undefined,
      revokedAt:
        statusCode === 3
          ? persistedRecord?.revoked_at || cached?.revokedAt || new Date().toISOString()
          : undefined,
      txHash:
        persistedRecord?.status === "active"
          ? persistedRequest?.onchain_issue_tx_hash || cached?.txHash
          : persistedRequest?.onchain_request_tx_hash || cached?.txHash,
      txId:
        persistedRecord?.status === "active"
          ? persistedRequest?.onchain_issue_tx_id || cached?.txId
          : persistedRequest?.onchain_request_tx_id || cached?.txId,
      mode: "onchain",
    };
  }

  getDeployMetadata(): DeployTransactionMetadata | null {
    if (!("deployTxData" in (this.contract as object))) return null;
    return this.contract as unknown as DeployTransactionMetadata;
  }
}
