import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { from, map, shareReplay, switchMap, type Observable } from "rxjs";
import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import type { AppProviders } from "../../../lib/providers";
import { logRawWalletError } from "../../../lib/providers";
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
    // Owner decision, 2026-07-21 (see the extensive comment on the Compact
    // constructor in did_registry.compact.template — do not revert without
    // the project owner's explicit sign-off): the constructor no longer
    // mints the genesis admin token atomically. It only deploys. The admin
    // token mint now happens in a second, separate transaction via
    // registerInitialAdmin() below, called right after deploy succeeds.
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
    // The SDK stores deploy TX metadata at contract.deployTxData (same pattern as DidRegistryAPI)
    api.deployTxData = (deployed as unknown as { deployTxData?: { public?: { txHash?: string; txId?: string } } }).deployTxData ?? null;
    return api;
  }

  // Owner decision, 2026-07-21: second step of the two-transaction bootstrap
  // (see the constructor comment in did_registry.compact.template). Mints
  // the genesis admin token to the deploying wallet's own shielded coin
  // public key. Ungated — first caller to invoke this after deploy becomes
  // admin, a race-condition risk the project owner explicitly accepted
  // (mitigation: discard and redeploy if lost). Still coin-based, not
  // ownPublicKey()-based — only the atomicity with deploy was removed.
  async registerInitialAdmin(): Promise<{ txHash: string; txId?: string }> {
    const adminRecipientBytes = fromHex(this.providers.shieldedCoinPublicKeyHex);
    const adminCoinNonce = crypto.getRandomValues(new Uint8Array(32));
    const adminSupply = 5n;
    const tx = await (
      this.contract.callTx.register_initial_admin as (
        recipient: { bytes: Uint8Array },
        coinNonce: Uint8Array,
        supply: bigint,
      ) => Promise<TxResult>
    )({ bytes: adminRecipientBytes }, adminCoinNonce, adminSupply);
    return { txHash: String(tx.public.txHash || ""), txId: tx.public.txId };
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
    console.debug("[_buildCoin] wallet balances vs. verified (valid_colors) colors", {
      allBalances: Object.fromEntries(
        Object.entries(rawBalances).map(([k, v]) => [k, String(v)]),
      ),
      verifiedColors: Array.from(verifiedColors),
    });

    for (const colorHex of verifiedColors) {
      const bal = rawBalances[colorHex];
      console.debug("[_buildCoin] checking verified color", { colorHex, balance: bal !== undefined ? String(bal) : undefined });
      if (bal !== undefined && BigInt(bal) >= 2n) {
        // value: 2n = 1 credit spent + 1 permanent anchor retained by the contract.
        // The wallet SDK exposes aggregate balances, not individual UTXOs.
        // If the balance >= 2n comes from many small UTXOs (each < 2n), the ZK proof
        // will fail at runtime with a coin-not-found error. Normal mint flow (batches of 5+)
        // avoids this; users with heavily fragmented wallets should request a re-mint.
        console.debug("[_buildCoin] selected coin", { colorHex, aggregateBalance: String(bal), syntheticValue: "2" });
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
    console.error("[_buildCoin] no verified color had balance >= 2n", {
      allBalances: Object.fromEntries(Object.entries(rawBalances).map(([k, v]) => [k, String(v)])),
      verifiedColors: Array.from(verifiedColors),
    });
    throw new Error(
      "No spendable action credits found. Your wallet needs shielded tokens with at least 2 units in a single coin.",
    );
  }

  // Feature 005-coin-gated-admin-access (ADR-001/ADR-003): mirrors _buildCoin()
  // but filters the caller's shielded balances against the single
  // ledger.admin_token_color value (exact equality) instead of
  // fetchVerifiedTokenColors()'s multi-color valid_colors membership. Used by
  // every admin-gated circuit call (consumeAdminToken() is the sole
  // authorization path for those circuits — see 2-technical/spec.md).
  private async _buildAdminCoin(): Promise<{ coin: ShieldedCoin; colorHex: string }> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress as never,
    );
    if (!state) throw new Error("Could not read unified registry ledger state");
    const ledger = this.module.ledger((state as { data: unknown }).data as never) as {
      admin_token_color: Uint8Array | { bytes: Uint8Array };
    };
    const rawColor = ledger.admin_token_color;
    const adminColorBytes =
      rawColor instanceof Uint8Array ? rawColor : (rawColor as { bytes: Uint8Array }).bytes;
    const adminColorHex = toHex(adminColorBytes);

    const rawBalances = (await this.providers.connectedAPI.getShieldedBalances()) as Record<
      string,
      bigint
    >;
    const bal = rawBalances[adminColorHex];
    if (bal !== undefined && BigInt(bal) >= 2n) {
      // value: 2n = 1 credit spent + 1 permanent anchor retained by the contract,
      // matching consumeAdminToken()'s value check (mirrors _buildCoin()).
      return {
        coin: {
          nonce: crypto.getRandomValues(new Uint8Array(32)),
          color: adminColorBytes,
          value: 2n,
        },
        colorHex: adminColorHex,
      };
    }
    throw new Error(
      "No spendable admin credits found. Your wallet needs an admin-colored shielded token with at least 2 units in a single coin.",
    );
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
    // Feature 005-coin-gated-admin-access (ADR-004): mint_capability_tokens is
    // now admin-token-gated; consumeAdminToken(coin) is the circuit's first
    // instruction, replacing the old assertRole(adminRole()) identity check.
    const { coin } = await this._buildAdminCoin();

    const tx = await (
      this.contract.callTx.mint_capability_tokens as (
        coin: ShieldedCoin,
        subscriptionKey: Uint8Array,
        recipient: { bytes: Uint8Array },
        coinNonce: Uint8Array,
        amount: bigint,
      ) => Promise<TxResult>
    )(coin, subscriptionKey, { bytes: opts.recipientBytes }, coinNonce, opts.credits);

    return { txHash: String(tx.public.txHash || ""), subscriptionKey };
  }

  // Feature 005-coin-gated-admin-access (ADR-002/ADR-003, restored per
  // explicit user-approved design fix 2026-07-09 on top of tasks 3/8):
  // rotates the caller's admin token — burns the presented admin coin and
  // mints a fresh new_supply+1-unit admin coin (1 anchor + new_supply
  // credits) to new_recipient, atomically in one circuit call. Mirrors how
  // mintTokens()/mint_capability_tokens handles its own amount parameter.
  async rotateAdminTokens(opts: {
    newRecipientBytes: Uint8Array;
    newSupply: bigint;
  }): Promise<{ txHash: string; txId?: string }> {
    const { coin } = await this._buildAdminCoin();
    const newCoinNonce = crypto.getRandomValues(new Uint8Array(32));
    const tx = await (
      this.contract.callTx.rotate_admin_tokens as (
        coin: ShieldedCoin,
        newRecipient: { bytes: Uint8Array },
        newCoinNonce: Uint8Array,
        newSupply: bigint,
      ) => Promise<TxResult>
    )(coin, { bytes: opts.newRecipientBytes }, newCoinNonce, opts.newSupply);
    return { txHash: String(tx.public.txHash || ""), txId: String(tx.public.txId || "") };
  }

  // ─── Gated DID operations ───────────────────────────────────────────────────

  async gatedSelfRegisterDid(opts: {
    subjectNonce: Uint8Array;
    agentId: string;
    subjectWalletAddress?: string;
    controller?: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure?: "disclosed" | "undisclosed";
    didDocument?: string;
  }): Promise<DidRecord> {
    const { coin, colorHex } = await this._buildCoin();
    console.debug("[gatedSelfRegisterDid] built coin, calling callTx.gated_self_register_did", {
      colorHex,
      contractAddress: this.contractAddress,
      subjectNonceHex: toHex(opts.subjectNonce),
    });

    const callStartedAt = Date.now();
    let tx;
    try {
      tx = await (
        this.contract.callTx.gated_self_register_did as (
          coin: ShieldedCoin,
          subjectNonce: Uint8Array,
        ) => Promise<{
          public: { txHash: string; txId?: string };
          private: { result: Uint8Array };
        }>
      )(coin, opts.subjectNonce);
    } catch (error) {
      logRawWalletError("gatedSelfRegisterDid: callTx.gated_self_register_did", error, {
        durationMs: Date.now() - callStartedAt,
        colorHex,
        contractAddress: this.contractAddress,
      });
      throw error;
    }
    console.debug("[gatedSelfRegisterDid] callTx.gated_self_register_did succeeded", {
      durationMs: Date.now() - callStartedAt,
      txHash: tx.public.txHash,
    });

    const didKeyHex = toHex(tx.private.result);
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
      controller: opts.controller,
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
      controller: opts.controller,
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
    // Feature 005-coin-gated-admin-access (ADR-001/ADR-004): grant_role now
    // requires a specifically admin-colored coin, not any valid capability
    // color.
    const { coin } = await this._buildAdminCoin();
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
    // Feature 005-coin-gated-admin-access (ADR-001/ADR-004): revoke_role now
    // requires a specifically admin-colored coin, not any valid capability
    // color.
    const { coin } = await this._buildAdminCoin();
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
    controller?: string;
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
      controller: input.controller,
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
    // Feature 006-clarify-did-controller-metadata: controller is only added
    // to the cache patch when explicitly provided — omitting it must fall
    // back to (not clobber) the previously cached value, unlike
    // subjectWalletAddress above which is always overwritten unconditionally.
    const cached = mergeDidMetadata(this.contractAddress, input.agentId, {
      subjectWalletAddress: input.subjectWalletAddress,
      didKeyHex,
      updatedAt: now,
      txHash: String(tx.public.txHash || ""),
      txId: String(tx.public.txId || ""),
      didDocument: input.didDocument.trim(),
      documentHashHex: toHex(docCommitment),
      proofCommitmentHex: toHex(capCommitment),
      ...(input.controller !== undefined ? { controller: input.controller } : {}),
    });
    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      controller: input.controller ?? cached.controller,
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
    const didKeyHex = input.didKeyHex ?? getDidMetadata(this.contractAddress, input.agentId)?.didKeyHex;
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
    // Feature 005-coin-gated-admin-access (ADR-001/ADR-004): revoke_did now
    // requires a specifically admin-colored coin, not any valid capability
    // color.
    const { coin } = await this._buildAdminCoin();
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

    // Feature 005-coin-gated-admin-access (ADR-004): issue_did is now
    // admin-token-gated; consumeAdminToken(coin) is the circuit's first
    // instruction, replacing the old inline is_admin || is_issuer check
    // (ISSUER role removed entirely).
    const { coin } = await this._buildAdminCoin();
    const tx = await (
      this.contract.callTx.issue_did as (
        coin: ShieldedCoin,
        didKeyArg: Uint8Array,
        didCommitmentArg: Uint8Array,
        documentCommitmentArg: Uint8Array,
        proofCommitmentArg: Uint8Array,
      ) => Promise<TxResult>
    )(coin, didKeyBytes, didCommitment, documentCommitment, proofCommitment);

    const now = new Date().toISOString();
    // Feature 006-clarify-did-controller-metadata: same conditional-patch +
    // cached-fallback treatment as updateDid — an issue call that omits
    // controller must preserve the previously cached value, not null it out.
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
      ...(input.controller !== undefined ? { controller: input.controller } : {}),
    });

    return {
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      controller: input.controller ?? cached.controller,
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
