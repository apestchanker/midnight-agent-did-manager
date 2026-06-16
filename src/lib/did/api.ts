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
  createRevocationCommitment,
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
import {
  createDeploymentPrivateState,
  getOwnerVaultStatus,
  persistSlotPrivateState,
} from "./vault";
import { getPersistedDidState } from "./service-sync";
import {
  MANAGED_CONTRACT_BASE_PATH,
  SLOT_PRIVATE_STATE_ID,
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
    const { module, compiledContract } = await getContractRuntime(MANAGED_CONTRACT_BASE_PATH);
    const deployed = await deployContract(providers as never, {
      compiledContract: compiledContract as never,
      args: [],
      privateStateId: SLOT_PRIVATE_STATE_ID,
      initialPrivateState: await createDeploymentPrivateState(providers),
    });

    const contractAddress = extractContractAddress(deployed);
    if (!contractAddress) {
      throw new Error(
        "Deployment succeeded but the contract address could not be derived from the Midnight SDK response.",
      );
    }

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
    });

    return new DidRegistryAPI(
      providers,
      contractAddress,
      module,
      compiledContract,
      contract as { callTx: Record<string, unknown> },
    );
  }

  async selfRegisterDid(input: {
    subjectNonce?: Uint8Array;
    agentId: string;
    subjectWalletAddress?: string;
    didDocument?: string;
  }): Promise<{ didKeyHex: string; txHash: string; txId?: string }> {
    const nonce = input.subjectNonce ?? new Uint8Array(32);
    const tx = await (this.contract.callTx.self_register_did as (
      subjectNonce: Uint8Array,
    ) => Promise<{ public: { txHash: string; txId?: string }; result: Uint8Array }>)(nonce);

    return {
      didKeyHex: toHex(tx.result),
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
    };
  }

  async issueDid(input: IssueDidInput & { didKeyHex: string }): Promise<DidRecord> {
    const didKeyBytes = fromHex(input.didKeyHex);
    const agentKey = await createAgentKey(input.agentId);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const didCommitment = await createDidCommitment({
      did,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
    });
    const documentCommitment = await createDocumentCommitment(input.didDocument);
    const proofCommitment = await createLifecycleProofCommitment({
      action: "issue_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
      did,
      didDocument: input.didDocument,
    });

    const tx = await (this.contract.callTx.issue_did as (
      didKeyArg: Uint8Array,
      didCommitmentArg: Uint8Array,
      documentCommitmentArg: Uint8Array,
      proofCommitmentArg: Uint8Array,
    ) => Promise<TxResult>)(didKeyBytes, didCommitment, documentCommitment, proofCommitment);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
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
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      agentKeyHex,
      did,
      didHashHex: toHex(didCommitment),
      didCommitmentHex: toHex(didCommitment),
      documentHashHex: toHex(documentCommitment),
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

  async updateDid(input: UpdateDidInput & { subjectNonce?: Uint8Array }): Promise<DidRecord> {
    const nonce = input.subjectNonce ?? new Uint8Array(32);
    const agentKey = await createAgentKey(input.agentId);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const documentCommitment = await createDocumentCommitment(input.didDocument);
    const proofCommitment = await createLifecycleProofCommitment({
      action: "update_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
      did,
      didDocument: input.didDocument,
    });

    const tx = await (this.contract.callTx.request_update_did as (
      subjectNonce: Uint8Array,
      updateCommitment: Uint8Array,
      capabilityCommitment: Uint8Array,
    ) => Promise<TxResult>)(nonce, documentCommitment, proofCommitment);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      didDocument: input.didDocument.trim(),
      documentHashHex: toHex(documentCommitment),
      proofCommitmentHex: toHex(proofCommitment),
    });

    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      agentKeyHex,
      did,
      didHashHex: cached.didCommitmentHex,
      didCommitmentHex: cached.didCommitmentHex,
      documentHashHex: toHex(documentCommitment),
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
    const agentKey = await createAgentKey(input.agentId);
    const agentKeyHex = toHex(agentKey);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      agentKeyHex,
    );
    const revocationCommitment = await createRevocationCommitment({
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
      did,
      reason: input.reason,
    });

    const tx = await (this.contract.callTx.revoke_did as (
      agentKeyArg: Uint8Array,
      revocationCommitmentArg: Uint8Array,
    ) => Promise<TxResult>)(agentKey, revocationCommitment);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      updatedAt: now,
      revokedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      revocationCommitmentHex: toHex(revocationCommitment),
    });

    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
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

  async fetchDidRecord(agentId: string, subjectWalletAddress?: string): Promise<DidRecord | null> {
    if (!this.contractAddress.trim() || !agentId.trim()) return null;

    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return null;

    return this.buildDidRecordFromLedger(
      this.module.ledger((state as { data: unknown }).data),
      agentId,
      subjectWalletAddress,
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

  agentRecord$(agentId: string, subjectWalletAddress?: string): Observable<DidRecord | null> {
    if (!agentId.trim()) return of(null);
    return this.ledgerState$.pipe(
      switchMap((ledgerState) =>
        from(this.buildDidRecordFromLedger(ledgerState, agentId, subjectWalletAddress)),
      ),
    );
  }

  private async buildDidRecordFromLedger(
    ledgerState: Record<string, unknown>,
    agentId: string,
    subjectWalletAddress?: string,
  ): Promise<DidRecord | null> {
    const agentKey = await createAgentKey(agentId);
    const agentKeyHex = toHex(agentKey);
    const statusCode = bigintishToNumber(
      mapLookupByHexKey(ledgerState.party_status, agentKeyHex, fromHex, toHex),
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
    const proofCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.proof_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const revocationCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.revocation_commitments, agentKeyHex, fromHex, toHex),
      toHex,
    );
    const cached = getDidMetadata(this.contractAddress, agentId);
    let persisted: Awaited<ReturnType<typeof getPersistedDidState>> | null = null;
    try {
      persisted = await getPersistedDidState({
        contractAddress: this.contractAddress,
        walletAddress: subjectWalletAddress || cached?.subjectWalletAddress || "",
        agentId,
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
      agentId,
      subjectWalletAddress:
        persistedRecord?.subject_wallet_address ||
        persistedRequest?.subject_wallet_address ||
        cached?.subjectWalletAddress,
      agentName:
        (typeof persistedRequest?.request_payload?.agentName === "string"
          ? persistedRequest.request_payload.agentName
          : undefined) || cached?.agentName,
      organization: persistedRecord?.organization_name || cached?.organization,
      organizationDisclosure: cached?.organizationDisclosure,
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
