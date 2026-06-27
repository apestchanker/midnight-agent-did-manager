import type { ShieldedCoin, TokenMintRecord, ActionType, CapabilityProof } from './token-types.js';
import { ACTION_TYPE_BYTES } from './token-types.js';
import type { TokenStateManager } from './token-state.js';

// ─── TokenProviders interface ─────────────────────────────────────────────────

/**
 * Providers the calling code must supply to mint and consume capability tokens.
 * The contract methods mirror what compact-runtime generates from token_gating.compact.
 */
export interface TokenProviders {
  tokenContract: {
    callTx: {
      mint_capability_tokens: (
        subscriptionKey: Uint8Array,
        recipient: { bytes: Uint8Array },
        coinNonce: Uint8Array,
        amount: bigint
      ) => Promise<{
        txHash: string;
        coinInfo?: { nonce: Uint8Array; color: Uint8Array; value: bigint };
      }>;
      consume_token_for_action: (
        coin: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint },
        actionType: Uint8Array,
        didKey: Uint8Array
      ) => Promise<{ txHash: string }>;
    };
    ledger: {
      capability_commitments: {
        lookup: (key: Uint8Array) => Promise<Uint8Array | undefined>;
        member: (key: Uint8Array) => Promise<boolean>;
      };
    };
  };
  didRegistryLedger: {
    party_status: {
      lookup: (key: Uint8Array) => Promise<number | undefined>;
      member: (key: Uint8Array) => Promise<boolean>;
    };
  };
  stateManager: TokenStateManager;
  /** Generate 32 cryptographically random bytes. */
  generateNonce: () => Uint8Array;
  /**
   * After consume_token_for_action TX confirms, resolve the actual commitment
   * value stored on-chain in capability_commitments[persistentHash(coinNonce)].
   *
   * In production: query the token contract ledger for the new entry.
   * In tests: return the commitment value from the circuit result directly.
   *
   * The raw coinNonce (not hashed) is passed — the implementation is responsible
   * for applying persistentHash if needed to compute the ledger key.
   */
  resolveCommitmentValue: (coinNonce: Uint8Array) => Promise<Uint8Array>;
}

// ─── mintCapabilityTokens ─────────────────────────────────────────────────────

/**
 * Calls the token_gating.mint_capability_tokens circuit to mint `amount`
 * capability credits for the given DID.  The minted UTXO has value = amount + 1
 * (the extra unit is the permanent anchor).
 */
/**
 * Admin mints subscription capability tokens for a user.
 *
 * `subscriptionKey` is a 32-byte value chosen by the admin that uniquely
 * identifies this user's subscription. The token color is derived from it
 * on-chain (persistentHash(subscriptionKey)) and is stored in the DID registry
 * when the user first calls self_register_did.
 *
 * `recipient` is the user's ZswapCoinPublicKey (shielded wallet address).
 * Tokens are minted directly to the recipient — the admin does not hold them.
 */
export async function mintCapabilityTokens(
  config: TokenProviders,
  subscriptionKey: Uint8Array,
  recipient: { bytes: Uint8Array },
  amount: bigint
): Promise<{ coin: ShieldedCoin; mintRecord: TokenMintRecord; txHash: string }> {
  if (amount < 1n) {
    throw new Error('TOKEN_INVALID_AMOUNT');
  }

  const coinNonce = config.generateNonce();

  const result = await config.tokenContract.callTx.mint_capability_tokens(
    subscriptionKey,
    recipient,
    coinNonce,
    amount
  );

  if (!result.coinInfo) {
    throw new Error('TOKEN_MINT_NO_COIN_INFO');
  }
  const coin: ShieldedCoin = {
    nonce: result.coinInfo.nonce,
    color: result.coinInfo.color,
    value: result.coinInfo.value,
    contractAddress: '',
  };

  const mintRecord: TokenMintRecord = {
    subscriptionKey,
    recipientBytes: recipient.bytes,
    contractAddress: '',
    mintedAt: new Date().toISOString(),
  };

  config.stateManager.onCoinMinted(coin, mintRecord);

  return { coin, mintRecord, txHash: result.txHash };
}

// ─── consumeTokenForAction ────────────────────────────────────────────────────

/**
 * Calls the token_gating.consume_token_for_action circuit.  Consumes one credit
 * from the coin and writes a capability commitment to the ledger.  Returns the
 * CapabilityProof that can be passed to the gated DID-registry circuits.
 */
export async function consumeTokenForAction(
  config: TokenProviders,
  coin: ShieldedCoin,
  actionType: ActionType,
  didKey: Uint8Array
): Promise<{ proof: CapabilityProof; receivedCoin: ShieldedCoin; txHash: string }> {
  if (coin.value <= 1n) {
    throw new Error('TOKEN_ANCHOR_PROTECTION');
  }

  const actionTypeBytes = ACTION_TYPE_BYTES[actionType];

  const result = await config.tokenContract.callTx.consume_token_for_action(
    {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: 0n,
    },
    actionTypeBytes,
    didKey
  );

  // The nullifier stored on the ledger is persistentHash(coin.nonce).
  // We use the raw nonce bytes as the local key; the contract maps nullifier_proxy→commitment.
  // coinColor is the color of the spent coin — required by self_register_did (v2) and
  // embedded in the commitment: persistentHash([action, contract, did_key, coin_color]).
  const proof: CapabilityProof = {
    nullifier: coin.nonce,
    commitmentValue: new Uint8Array(32), // populated from ledger after TX confirms
    actionType,
    didKey,
    tokenContractAddress: '',
    coinColor: coin.color,
  };

  const receivedCoin: ShieldedCoin = {
    nonce: config.generateNonce(),
    color: coin.color,
    value: coin.value - 1n,
    contractAddress: coin.contractAddress,
  };

  // Resolve actual commitment from ledger after TX confirms
  const commitmentValue = await config.resolveCommitmentValue(coin.nonce);
  proof.commitmentValue = commitmentValue;

  config.stateManager.onCoinConsumed(coin, receivedCoin);
  config.stateManager.savePendingProof(proof);

  return { proof, receivedCoin, txHash: result.txHash };
}

// ─── executeGatedAction ───────────────────────────────────────────────────────

/**
 * Orchestrates a two-TX gated DID registry action (REQ-11).
 *
 * TX1: consume_token_for_action — spends 1 credit and produces a capability proof.
 * TX2: the gated DID action — receives the proof and executes on-chain.
 *
 * The orchestrator handles:
 * - Selecting the best spendable coin from state.
 * - Checking for a pending proof (TX1 already completed, TX2 failed) to avoid
 *   double-consuming.
 * - Persisting the proof between TX1 and TX2 so TX2 can be retried if it fails.
 * - Clearing the pending proof after TX2 confirms.
 *
 * @param config - TokenProviders (must include resolveCommitmentValue)
 * @param actionType - The gated action being executed
 * @param didKey - Subject DID key (32 bytes)
 * @param executeAction - Callback that calls the gated circuit with the proof
 */
export async function executeGatedAction(
  config: TokenProviders,
  actionType: ActionType,
  didKey: Uint8Array,
  executeAction: (proof: CapabilityProof) => Promise<{ txHash: string }>,
): Promise<{ proof: CapabilityProof; txHash: string }> {
  const didKeyHex = Buffer.from(didKey).toString('hex');

  // Check for a pending proof — TX1 may have already completed on a previous attempt
  let proof = config.stateManager.getPendingProof(actionType, didKeyHex);

  if (!proof) {
    // TX1: select best coin and consume
    const coin = config.stateManager.getSpendableCoin();
    if (!coin) {
      throw new Error('TOKEN_INSUFFICIENT_CREDITS');
    }
    const { proof: newProof } = await consumeTokenForAction(config, coin, actionType, didKey);
    proof = newProof;
  }

  // TX2: execute the gated action
  const { txHash } = await executeAction(proof);

  // Clear the pending proof — TX2 confirmed
  config.stateManager.clearPendingProof(actionType, didKeyHex);

  return { proof, txHash };
}
