import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import type { AppProviders } from "../../../lib/providers";
import { fromHex, toHex } from "../../../lib/wallet-bridge";
import { extractContractAddress } from "../did/runtime";
import { generateSubscriptionKey } from "./subscription";
import type { CapabilityProof, ActionType } from "./token-types";
import { ACTION_TYPE_BYTES } from "./token-types";

const TOKEN_GATING_CONTRACT_BASE_PATH = "/contracts/managed/token-gating";

type TxResult = { public: { txHash: string } };
type TokenGatingModule = Awaited<ReturnType<typeof loadTokenGatingModule>>;

async function loadTokenGatingModule() {
  try {
    return await import("../../generated/tokenGatingContract.runtime.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import failure";
    throw new Error(
      `Token gating contract runtime is missing. Run \`npm run compile-token-gating\` first. Details: ${message}`,
    );
  }
}

export class TokenGatingAPI {
  readonly contractAddress: string;
  private readonly providers: AppProviders;
  private readonly module: TokenGatingModule;
  private readonly contract: { callTx: Record<string, unknown> };

  private constructor(
    contractAddress: string,
    providers: AppProviders,
    module: TokenGatingModule,
    contract: { callTx: Record<string, unknown> },
  ) {
    this.contractAddress = contractAddress;
    this.providers = providers;
    this.module = module;
    this.contract = contract;
  }

  static async deploy(providers: AppProviders): Promise<TokenGatingAPI> {
    const module = await loadTokenGatingModule();
    const contractDefinition = CompactCompiledContract.withVacantWitnesses(
      CompactCompiledContract.make("token-gating", module.Contract as never),
    ) as never;
    const compiledContract = CompactCompiledContract.withCompiledFileAssets(
      contractDefinition,
      TOKEN_GATING_CONTRACT_BASE_PATH as never,
    ) as never;

    const deployed = await deployContract(providers as never, {
      compiledContract,
      args: [],
    });

    const contractAddress = extractContractAddress(deployed);
    if (!contractAddress) {
      throw new Error(
        "Token gating deployment succeeded but the contract address could not be derived from the Midnight SDK response.",
      );
    }

    return new TokenGatingAPI(contractAddress, providers, module, deployed as { callTx: Record<string, unknown> });
  }

  static async join(providers: AppProviders, contractAddress: string): Promise<TokenGatingAPI> {
    const module = await loadTokenGatingModule();
    const contractDefinition = CompactCompiledContract.withVacantWitnesses(
      CompactCompiledContract.make("token-gating", module.Contract as never),
    ) as never;
    const compiledContract = CompactCompiledContract.withCompiledFileAssets(
      contractDefinition,
      TOKEN_GATING_CONTRACT_BASE_PATH as never,
    ) as never;

    const contract = await findDeployedContract(providers as never, {
      compiledContract: compiledContract as never,
      contractAddress: contractAddress as never,
    });

    return new TokenGatingAPI(contractAddress, providers, module, contract as { callTx: Record<string, unknown> });
  }

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
      if (
        ledger.valid_colors.member(colorBytes) &&
        ledger.valid_colors.lookup(colorBytes)
      ) {
        verified.add(toHex(colorBytes));
      }
    }
    return verified;
  }

  /**
   * Consumes one action credit from the wallet's shielded balance, writing a
   * capability commitment on-chain. Returns the CapabilityProof needed by the
   * gated DID registry circuits (nullifier + commitmentValue + coinColor).
   *
   * TX flow:
   *  1. Read wallet's shielded balance → find a verified token color with value >= 2.
   *  2. Call consume_token_for_action circuit (spends 1 credit, emits commitment).
   *  3. Read the on-chain commitment from capability_commitments ledger map.
   *  4. Return CapabilityProof.
   */
  async consumeForAction(
    didKey: Uint8Array,
    actionType: ActionType,
  ): Promise<CapabilityProof> {
    // Read wallet balances to find a valid token color (color → bigint balance)
    const rawBalances = await this.providers.connectedAPI.getShieldedBalances() as Record<string, bigint>;

    // Find a color verified by this contract with value >= 2 (anchor-protected)
    const verifiedColors = await this.fetchVerifiedTokenColors(Object.keys(rawBalances));
    let tokenColor: Uint8Array | null = null;
    for (const colorHex of verifiedColors) {
      const bal = rawBalances[colorHex];
      if (bal !== undefined && BigInt(bal) >= 2n) {
        tokenColor = fromHex(colorHex);
        break;
      }
    }
    if (!tokenColor) {
      throw new Error("No spendable action credits found. Wallet needs shielded tokens with value >= 2.");
    }

    // Pass value=2n: the circuit requires >= 2 (consumes 1, returns 1 as change).
    // The wallet's balanceUnsealedTransaction selects the actual UTXOs internally via
    // Zswap — the DApp never needs to know individual UTXO values or nonces.
    // Passing the full aggregate balance was causing "Balance failed: Insufficient funds"
    // because two shielded ops (receiveShielded + sendImmediateShielded) on a large
    // value exhausted fee DUST in the wallet.
    const coinNonce = crypto.getRandomValues(new Uint8Array(32));

    await (
      this.contract.callTx.consume_token_for_action as (
        coin: { nonce: Uint8Array; color: Uint8Array; value: bigint },
        actionType: Uint8Array,
        didKey: Uint8Array,
      ) => Promise<TxResult>
    )(
      { nonce: coinNonce, color: tokenColor, value: 2n },
      ACTION_TYPE_BYTES[actionType],
      didKey,
    );

    // Compute the commitment value off-chain using the same formula as the circuit:
    //   nullifier_proxy = persistentHash<Bytes<32>>(public_nonce)
    //   commitment = persistentHash<Vector<5, Bytes<32>>>([action, contract_addr, did_key, color, nullifier_proxy])
    // This avoids a queryContractState round-trip and works even when the indexer
    // hasn't yet indexed the token-gating contract state.
    const { persistentHash, Bytes32Descriptor, CompactTypeVector } = await import("@midnight-ntwrk/compact-runtime");
    const nullifierProxy = persistentHash(Bytes32Descriptor, coinNonce);
    const contractAddressBytes = fromHex(this.contractAddress);
    const commitmentValue = persistentHash(
      new CompactTypeVector(5, Bytes32Descriptor),
      [ACTION_TYPE_BYTES[actionType], contractAddressBytes, didKey, tokenColor, nullifierProxy],
    );

    return {
      nullifier: coinNonce,
      commitmentValue,
      actionType,
      didKey,
      tokenContractAddress: this.contractAddress,
      coinColor: tokenColor,
    };
  }

  /**
   * Admin mints shielded action credits to a user's shielded wallet address.
   *
   * @param recipientBytes - The user's ZswapCoinPublicKey.bytes (32-byte shielded public key)
   * @param userId - Opaque identifier used to derive a deterministic subscription key
   * @param credits - Number of action credits to grant (circuit mints credits + 1 anchor)
   */
  async mintToRecipient(
    recipientBytes: Uint8Array,
    userId: string,
    credits: bigint,
  ): Promise<{ txHash: string; subscriptionKey: Uint8Array }> {
    if (credits < 1n) throw new Error("Credits must be >= 1");

    const subscriptionKey = generateSubscriptionKey(userId, Date.now());
    const coinNonce = crypto.getRandomValues(new Uint8Array(32));

    console.debug("[TokenGatingAPI] mintToRecipient params", {
      recipientLength: recipientBytes.length,
      recipientHex: Buffer.from(recipientBytes).toString("hex"),
      subscriptionKeyHex: Buffer.from(subscriptionKey).toString("hex"),
      coinNonceLength: coinNonce.length,
      credits,
      contractAddress: this.contractAddress,
    });

    const tx = await (
      this.contract.callTx.mint_capability_tokens as (
        subscriptionKey: Uint8Array,
        recipient: { bytes: Uint8Array },
        coinNonce: Uint8Array,
        amount: bigint,
      ) => Promise<TxResult>
    )(subscriptionKey, { bytes: recipientBytes }, coinNonce, credits);

    return { txHash: tx.public.txHash, subscriptionKey };
  }
}
