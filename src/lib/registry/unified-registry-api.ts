import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { from, map, shareReplay, switchMap, type Observable } from "rxjs";
import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import type { AppProviders } from "../../../lib/providers";
import { fromHex, toHex } from "../../../lib/wallet-bridge";
// toHex re-exported for ledger helpers that require it as a parameter
import { extractContractAddress } from "../did/runtime";
import { generateSubscriptionKey } from "../token/subscription";
import {
  createDidCommitment,
  createDidIdentifier,
  createDocumentCommitment,
  createLifecycleProofCommitment,
  createRequestCommitment,
  randomBytes,
} from "../did/commitments";
import { getDidMetadata, mergeDidMetadata } from "../did/cache";
import {
  bigintishToNumber,
  deriveRegistryAccess,
  deriveRegistrySummary,
  mapLookupByHexKey,
  toRecordHex,
} from "../did/ledger";
import { createAgentKey } from "../did/commitments";
import { getPersistedDidState } from "../did/service-sync";
import type {
  DidRecord,
  IssueDidInput,
  RegistryAccess,
  RegistrySummary,
  RevokeDidInput,
  UpdateDidInput,
} from "../../types/did";
import { MANAGED_CONTRACT_BASE_PATH } from "../did/types";

type TxResult = { public: { txHash: string; txId?: string } };
type ShieldedCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint };

async function loadUnifiedModule() {
  try {
    return await import("../../generated/didRegistryContract.runtime.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import failure";
    throw new Error(
      `Unified registry contract runtime is missing. Run \`npm run compile-contract\` first. Details: ${message}`,
    );
  }
}

type UnifiedModule = Awaited<ReturnType<typeof loadUnifiedModule>>;

export class UnifiedRegistryAPI {
  readonly contractAddress: string;
  readonly networkId: string;
  readonly ledgerState$: Observable<Record<string, unknown>>;
  readonly registrySummary$: Observable<import("../../types/did").RegistrySummary>;

  private deployTxData: { public?: { txHash?: string; txId?: string } } | null = null;

  private constructor(
    readonly providers: AppProviders,
    contractAddress: string,
    private readonly module: UnifiedModule,
    private readonly contract: { callTx: Record<string, unknown> },
  ) {
    this.contractAddress = contractAddress;
    this.networkId = providers.networkId;

    this.ledgerState$ = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress as never, { type: "latest" })
      .pipe(
        map((state) => this.module.ledger((state as { data: unknown }).data as never)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    this.registrySummary$ = this.ledgerState$.pipe(
      map((ledgerState) =>
        deriveRegistrySummary(ledgerState, this.contractAddress, this.providers.networkId),
      ),
    );
  }

  agentRecord$(agentId: string, subjectWalletAddress?: string): Observable<import("../../types/did").DidRecord | null> {
    return this.ledgerState$.pipe(
      switchMap((ledgerState) =>
        from(this._buildDidRecordFromLedger(ledgerState, agentId, subjectWalletAddress)),
      ),
    );
  }

  access$(walletAddress: string): Observable<import("../../types/did").RegistryAccess | null> {
    return this.ledgerState$.pipe(
      switchMap((ledgerState) =>
        from(deriveRegistryAccess(ledgerState, this.contractAddress, walletAddress, toHex)),
      ),
    );
  }

  private static async _makeCompiled(module: UnifiedModule) {
    const contractDefinition = CompactCompiledContract.withVacantWitnesses(
      CompactCompiledContract.make("did-registry", module.Contract as never),
    ) as never;
    return CompactCompiledContract.withCompiledFileAssets(
      contractDefinition,
      MANAGED_CONTRACT_BASE_PATH as never,
    ) as never;
  }

  static async deploy(providers: AppProviders): Promise<UnifiedRegistryAPI> {
    const module = await loadUnifiedModule();
    const compiledContract = await UnifiedRegistryAPI._makeCompiled(module);

    const salt = randomBytes(32);
    const deployed = await deployContract(providers as never, {
      compiledContract: compiledContract as never,
      args: [salt],
    });

    const contractAddress = extractContractAddress(deployed);
    if (!contractAddress) {
      throw new Error(
        "Unified registry deployment succeeded but the contract address could not be derived.",
      );
    }

    const api = new UnifiedRegistryAPI(
      providers,
      contractAddress,
      module,
      deployed as { callTx: Record<string, unknown> },
    );
    api.deployTxData = (deployed as { public?: { txHash?: string; txId?: string } }) ?? null;
    return api;
  }

  getDeployMetadata(): { public?: { txHash?: string; txId?: string } } | null {
    return this.deployTxData;
  }

  static async join(
    providers: AppProviders,
    contractAddress: string,
  ): Promise<UnifiedRegistryAPI> {
    const module = await loadUnifiedModule();
    const compiledContract = await UnifiedRegistryAPI._makeCompiled(module);

    const contract = await findDeployedContract(providers as never, {
      compiledContract: compiledContract as never,
      contractAddress: contractAddress as never,
    });

    return new UnifiedRegistryAPI(
      providers,
      contractAddress,
      module,
      contract as { callTx: Record<string, unknown> },
    );
  }

  // ─── Token helpers ─────────────────────────────────────────────────────────

  async fetchVerifiedTokenColors(colors: Iterable<string>): Promise<Set<string>> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return new Set();

    const ledger = this.module.ledger((state as { data: unknown }).data as never);
    const verified = new Set<string>();
    for (const color of colors) {
      const normalized = color.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) continue;
      const colorBytes = fromHex(normalized);
      if (ledger.valid_colors.member(colorBytes) && ledger.valid_colors.lookup(colorBytes)) {
        verified.add(toHex(colorBytes));
      }
    }
    return verified;
  }

  private async _buildCoin(): Promise<{ coin: ShieldedCoin; colorHex: string }> {
    const rawBalances = (await this.providers.connectedAPI.getShieldedBalances()) as Record<
      string,
      bigint
    >;
    const verifiedColors = await this.fetchVerifiedTokenColors(Object.keys(rawBalances));

    for (const colorHex of verifiedColors) {
      const bal = rawBalances[colorHex];
      if (bal !== undefined && BigInt(bal) >= 2n) {
        return {
          coin: {
            nonce: crypto.getRandomValues(new Uint8Array(32)),
            color: fromHex(colorHex),
            value: 2n,
          },
          colorHex,
        };
      }
    }
    throw new Error(
      "No spendable action credits found. Wallet needs shielded tokens with value >= 2.",
    );
  }

  // ─── Admin bootstrap ────────────────────────────────────────────────────────

  async registerInitialAdmin(): Promise<{ txHash: string; txId?: string }> {
    const tx = await (
      this.contract.callTx.register_initial_admin as () => Promise<TxResult>
    )();
    return {
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
    };
  }

  // ─── Token minting ──────────────────────────────────────────────────────────

  async mintTokens(opts: {
    recipientBytes: Uint8Array;
    userId: string;
    credits: bigint;
  }): Promise<{ txHash: string; subscriptionKey: Uint8Array }> {
    if (opts.credits < 1n) throw new Error("Credits must be >= 1");

    const subscriptionKey = generateSubscriptionKey(opts.userId, Date.now());
    const coinNonce = crypto.getRandomValues(new Uint8Array(32));

    const tx = await (
      this.contract.callTx.mint_capability_tokens as (
        subscriptionKey: Uint8Array,
        recipient: { bytes: Uint8Array },
        coinNonce: Uint8Array,
        amount: bigint,
      ) => Promise<TxResult>
    )(subscriptionKey, { bytes: opts.recipientBytes }, coinNonce, opts.credits);

    return { txHash: String(tx.public.txHash || ""), subscriptionKey };
  }

  // ─── Gated DID operations ───────────────────────────────────────────────────

  async gatedSelfRegisterDid(opts: {
    subjectNonce: Uint8Array;
    agentId: string;
    subjectWalletAddress?: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure?: "disclosed" | "undisclosed";
    didDocument?: string;
  }): Promise<DidRecord> {
    const { coin } = await this._buildCoin();

    const tx = await (
      this.contract.callTx.gated_self_register_did as (
        coin: ShieldedCoin,
        subjectNonce: Uint8Array,
      ) => Promise<{ public: { txHash: string; txId?: string }; result: Uint8Array }>
    )(coin, opts.subjectNonce);

    const didKeyHex = toHex(tx.result);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      didKeyHex,
    );
    const requestCommitment = await createRequestCommitment({
      contractAddress: this.contractAddress,
      agentId: opts.agentId,
      agentName: opts.agentName,
      organization: opts.organization,
      organizationDisclosure: opts.organizationDisclosure || "undisclosed",
      didDocument: opts.didDocument ?? "",
    });
    const proofCommitment = await createLifecycleProofCommitment({
      action: "issue_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: opts.agentId,
      did,
      didDocument: opts.didDocument ?? "",
    });
    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, opts.agentId, {
      didKeyHex,
      subjectWalletAddress: opts.subjectWalletAddress,
      agentName: opts.agentName,
      organization:
        opts.organizationDisclosure === "disclosed" ? opts.organization : undefined,
      organizationDisclosure: opts.organizationDisclosure,
      didDocument: opts.didDocument?.trim(),
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      requestCommitmentHex: toHex(requestCommitment),
      proofCommitmentHex: toHex(proofCommitment),
    });

    return {
      agentId: opts.agentId,
      subjectWalletAddress: opts.subjectWalletAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: opts.didDocument?.trim() ?? "",
      didKeyHex,
      agentKeyHex: didKeyHex,
      did,
      requestCommitmentHex: toHex(requestCommitment),
      proofCommitmentHex: toHex(proofCommitment),
      status: "pending_issuance",
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async requestUpdateDid(opts: {
    subjectNonce: Uint8Array;
    docCommitment: Uint8Array;
    capCommitment: Uint8Array;
  }): Promise<{ txHash: string; txId?: string }> {
    const { coin } = await this._buildCoin();
    const tx = await (
      this.contract.callTx.request_update_did as (
        coin: ShieldedCoin,
        subjectNonce: Uint8Array,
        docCommitment: Uint8Array,
        capCommitment: Uint8Array,
      ) => Promise<TxResult>
    )(coin, opts.subjectNonce, opts.docCommitment, opts.capCommitment);
    return { txHash: String(tx.public.txHash || ""), txId: String(tx.public.txId || "") };
  }

  async grantRole(opts: {
    didKey: Uint8Array;
    role: Uint8Array;
  }): Promise<{ txHash: string; txId?: string }> {
    const { coin } = await this._buildCoin();
    const tx = await (
      this.contract.callTx.grant_role as (
        coin: ShieldedCoin,
        didKey: Uint8Array,
        role: Uint8Array,
      ) => Promise<TxResult>
    )(coin, opts.didKey, opts.role);
    return { txHash: String(tx.public.txHash || ""), txId: String(tx.public.txId || "") };
  }

  async revokeRole(opts: {
    didKey: Uint8Array;
    role: Uint8Array;
  }): Promise<{ txHash: string; txId?: string }> {
    const { coin } = await this._buildCoin();
    const tx = await (
      this.contract.callTx.revoke_role as (
        coin: ShieldedCoin,
        didKey: Uint8Array,
        role: Uint8Array,
      ) => Promise<TxResult>
    )(coin, opts.didKey, opts.role);
    return { txHash: String(tx.public.txHash || ""), txId: String(tx.public.txId || "") };
  }

  async requestDid(input: {
    requesterWalletAddress?: string;
    agentId: string;
    subjectWalletAddress?: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure?: "disclosed" | "undisclosed";
    didDocument?: string;
    subjectNonce?: Uint8Array;
  }): Promise<DidRecord> {
    const { getDefaultSubjectNonce } = await import("../did/private-state");
    const nonce = input.subjectNonce ?? (await getDefaultSubjectNonce());
    return this.gatedSelfRegisterDid({
      subjectNonce: nonce,
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      agentName: input.agentName,
      organization: input.organization,
      organizationDisclosure: input.organizationDisclosure,
      didDocument: input.didDocument,
    });
  }

  // ─── DidRegistryAPI-compatible wrappers (for app-api.ts compatibility) ─────

  async updateDid(input: UpdateDidInput & { subjectNonce?: Uint8Array }): Promise<DidRecord> {
    const { getDefaultSubjectNonce } = await import("../did/private-state");
    const nonce = input.subjectNonce ?? (await getDefaultSubjectNonce());
    const didKeyHex = getDidMetadata(this.contractAddress, input.agentId)?.didKeyHex;
    if (!didKeyHex) throw new Error("DID key is missing. Self-register the DID before updating it.");
    const did = await createDidIdentifier(this.providers.networkId, this.contractAddress, didKeyHex);
    const docCommitment = await createDocumentCommitment(input.didDocument);
    const capCommitment = await createLifecycleProofCommitment({
      action: "update_did",
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
      did,
      didDocument: input.didDocument,
    });
    const { coin } = await this._buildCoin();
    const tx = await (
      this.contract.callTx.request_update_did as (
        coin: ShieldedCoin,
        subjectNonce: Uint8Array,
        docCommitment: Uint8Array,
        capCommitment: Uint8Array,
      ) => Promise<TxResult>
    )(coin, nonce, docCommitment, capCommitment);
    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      didKeyHex,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      didDocument: input.didDocument.trim(),
      documentHashHex: toHex(docCommitment),
      proofCommitmentHex: toHex(capCommitment),
    });
    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: input.didDocument.trim(),
      didKeyHex,
      agentKeyHex: didKeyHex,
      did,
      documentHashHex: toHex(docCommitment),
      proofCommitmentHex: toHex(capCommitment),
      status: "active",
      proofStatus: "verified",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  async revokeDid(input: RevokeDidInput): Promise<DidRecord> {
    const { createRevocationCommitment } = await import("../did/commitments");
    const didKeyHex = (input as { didKeyHex?: string }).didKeyHex || getDidMetadata(this.contractAddress, input.agentId)?.didKeyHex;
    if (!didKeyHex) throw new Error("DID key is missing.");
    const didKeyBytes = fromHex(didKeyHex);
    const did = await createDidIdentifier(this.providers.networkId, this.contractAddress, didKeyHex);
    const revCommitment = await createRevocationCommitment({
      networkId: this.providers.networkId,
      contractAddress: this.contractAddress,
      agentId: input.agentId,
      did,
      reason: input.reason,
    });
    const { coin } = await this._buildCoin();
    const tx = await (
      this.contract.callTx.revoke_did as (
        coin: ShieldedCoin,
        didKey: Uint8Array,
      ) => Promise<TxResult>
    )(coin, didKeyBytes);
    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      didKeyHex,
      updatedAt: now,
      revokedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      revocationCommitmentHex: toHex(revCommitment),
    });
    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      agentName: cached.agentName,
      organization: cached.organization,
      organizationDisclosure: cached.organizationDisclosure,
      didDocument: cached.didDocument ?? "",
      didKeyHex,
      agentKeyHex: didKeyHex,
      did,
      revocationCommitmentHex: toHex(revCommitment),
      status: "revoked",
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  // ─── Non-gated operations ────────────────────────────────────────────────────

  async issueDid(input: IssueDidInput): Promise<DidRecord> {
    const didKeyHex =
      input.didKeyHex || getDidMetadata(this.contractAddress, input.agentId)?.didKeyHex;
    if (!didKeyHex) {
      throw new Error("DID key is missing. Self-register the DID before issuing it.");
    }
    const didKeyBytes = fromHex(didKeyHex);
    const did = await createDidIdentifier(
      this.providers.networkId,
      this.contractAddress,
      didKeyHex,
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

    const tx = await (
      this.contract.callTx.issue_did as (
        didKeyArg: Uint8Array,
        didCommitmentArg: Uint8Array,
        documentCommitmentArg: Uint8Array,
        proofCommitmentArg: Uint8Array,
      ) => Promise<TxResult>
    )(didKeyBytes, didCommitment, documentCommitment, proofCommitment);

    const now = new Date().toISOString();
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      didKeyHex,
      updatedAt: now,
      issuedAt: now,
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
      didKeyHex,
      agentKeyHex: didKeyHex,
      did,
      requestCommitmentHex: cached.requestCommitmentHex ?? "",
      proofCommitmentHex: toHex(proofCommitment),
      status: "active",
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: cached.createdAt,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      mode: "onchain",
    };
  }

  // ─── Read methods ────────────────────────────────────────────────────────────

  async readRegistrySalt(): Promise<Uint8Array> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) throw new Error("Could not read unified registry ledger state");
    const ledger = this.module.ledger((state as { data: unknown }).data as never);
    const salt = ledger.registry_salt;
    if (salt instanceof Uint8Array) return salt;
    if (salt && typeof salt === "object" && "bytes" in salt)
      return (salt as { bytes: Uint8Array }).bytes;
    throw new Error("registry_salt not found in unified registry ledger");
  }

  async fetchRegistrySummary(): Promise<RegistrySummary> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) throw new Error("Could not read unified registry ledger state");
    const ledger = this.module.ledger((state as { data: unknown }).data as never);
    return deriveRegistrySummary(ledger, this.contractAddress, this.providers.networkId);
  }

  async fetchRegistryAccess(walletAddress: string): Promise<RegistryAccess> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) throw new Error("Could not read unified registry ledger state");
    const ledger = this.module.ledger((state as { data: unknown }).data as never);
    return deriveRegistryAccess(ledger, this.contractAddress, walletAddress, toHex);
  }

  async readShieldedBalance(): Promise<Record<string, bigint>> {
    return (await this.providers.connectedAPI.getShieldedBalances()) as Record<string, bigint>;
  }

  async fetchDidRecord(agentId: string, subjectWalletAddress?: string): Promise<DidRecord | null> {
    if (!this.contractAddress.trim() || !agentId.trim()) return null;
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) return null;
    const ledger = this.module.ledger((state as { data: unknown }).data as never);
    return this._buildDidRecordFromLedger(ledger, agentId, subjectWalletAddress);
  }

  private async _buildDidRecordFromLedger(
    ledgerState: Record<string, unknown>,
    agentId: string,
    subjectWalletAddress?: string,
  ): Promise<DidRecord | null> {
    const agentKey = await createAgentKey(agentId);
    const fallbackAgentKeyHex = toHex(agentKey);
    const cached = getDidMetadata(this.contractAddress, agentId);
    const didKeyHex = cached?.didKeyHex || fallbackAgentKeyHex;
    const statusCode = bigintishToNumber(
      mapLookupByHexKey(ledgerState.party_status, didKeyHex, fromHex, toHex),
    );
    if (!statusCode) return null;

    const didCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.did_commitments, didKeyHex, fromHex, toHex),
      toHex,
    );
    const documentHashHex = toRecordHex(
      mapLookupByHexKey(ledgerState.document_commitments, didKeyHex, fromHex, toHex),
      toHex,
    );
    const proofCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.proof_commitments, didKeyHex, fromHex, toHex),
      toHex,
    );
    const revocationCommitmentHex = toRecordHex(
      mapLookupByHexKey(ledgerState.revocation_commitments, didKeyHex, fromHex, toHex),
      toHex,
    );

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
      ? await createDidIdentifier(this.providers.networkId, this.contractAddress, didKeyHex)
      : undefined;

    const { statusCodeToDidStatus } = await import("../did/ledger");

    return {
      agentId,
      subjectWalletAddress:
        persistedRecord?.subject_wallet_address ||
        persistedRequest?.subject_wallet_address ||
        cached?.subjectWalletAddress,
      agentName: cached?.agentName,
      organization: cached?.organization,
      organizationDisclosure: cached?.organizationDisclosure,
      didDocument: cached?.didDocument ?? "",
      didKeyHex,
      agentKeyHex: didKeyHex,
      did,
      requestCommitmentHex: cached?.requestCommitmentHex,
      proofCommitmentHex: proofCommitmentHex ?? cached?.proofCommitmentHex,
      didCommitmentHex: didCommitmentHex ?? undefined,
      documentHashHex: documentHashHex ?? undefined,
      revocationCommitmentHex: revocationCommitmentHex ?? undefined,
      status: statusCodeToDidStatus(statusCode),
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: cached?.createdAt ?? new Date().toISOString(),
      updatedAt: cached?.updatedAt ?? new Date().toISOString(),
      txHash: cached?.txHash,
      txId: cached?.txId,
      mode: "onchain",
    };
  }
}
