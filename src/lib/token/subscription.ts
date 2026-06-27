/**
 * Admin subscription grant flow (REQ-10).
 *
 * When a user obtains a subscription (via payment or admin grant), the admin:
 *   1. Generates a unique subscriptionKey for this user.
 *   2. Calls mint_capability_tokens(subscriptionKey, userRecipient, amount).
 *   3. Records the SubscriptionRecord.
 *
 * The token color is derived on-chain from the subscriptionKey and is stored
 * in the DID registry when the user first calls self_register_did. All subsequent
 * operations on that DID require spending a token of the same color.
 */

import { createHash } from 'crypto';
import type { ShieldedCoin, SubscriptionRecord } from './token-types.js';
import { mintCapabilityTokens, type TokenProviders } from './token-witness.js';

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generates a deterministic 32-byte subscription key unique to a (userId, timestamp) pair.
 * The admin uses this as the `subscriptionKey` parameter for `mint_capability_tokens`.
 *
 * In production, `timestamp` should be the subscription creation time (ms since epoch)
 * to ensure uniqueness even if the same user is re-subscribed.
 */
export function generateSubscriptionKey(userId: string, timestamp: number = Date.now()): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`${userId}:${timestamp}`).digest()
  );
}

// ─── Admin grant ──────────────────────────────────────────────────────────────

export interface GrantSubscriptionResult {
  /** The subscription key used — store this to correlate with the DID color later. */
  subscriptionKey: Uint8Array;
  /** The minted coin in the user's shielded wallet. */
  coin: ShieldedCoin;
  /** The subscription record to persist on the admin side. */
  record: SubscriptionRecord;
  txHash: string;
}

/**
 * Admin grants a subscription to a user by minting capability tokens to their
 * shielded wallet address.
 *
 * @param config - TokenProviders with admin's token contract access
 * @param userId - Opaque user identifier (used to generate subscriptionKey)
 * @param userRecipient - User's ZswapCoinPublicKey (shielded address bytes)
 * @param creditsToGrant - Number of usable capability credits (circuit mints this + 1 anchor)
 * @param timestampMs - Optional timestamp for key generation (defaults to now)
 */
export async function grantSubscription(
  config: TokenProviders,
  userId: string,
  userRecipient: { bytes: Uint8Array },
  creditsToGrant: bigint,
  timestampMs: number = Date.now(),
): Promise<GrantSubscriptionResult> {
  if (creditsToGrant < 1n) {
    throw new Error('SUBSCRIPTION_INVALID_AMOUNT');
  }

  const subscriptionKey = generateSubscriptionKey(userId, timestampMs);

  const { coin, txHash } = await mintCapabilityTokens(
    config,
    subscriptionKey,
    userRecipient,
    creditsToGrant,
  );

  const record: SubscriptionRecord = {
    subscriptionKey,
    recipientBytes: userRecipient.bytes,
    creditsGranted: creditsToGrant,
    contractAddress: config.stateManager.contractAddress,
    grantedAt: new Date(timestampMs).toISOString(),
  };

  return { subscriptionKey, coin, record, txHash };
}

// ─── Renewal / top-up ────────────────────────────────────────────────────────

/**
 * Admin tops up an existing subscription by minting additional tokens with the
 * SAME subscriptionKey as the original grant. This produces tokens of the same
 * color, which the user can spend alongside their existing credits.
 *
 * Use the subscriptionKey from the original SubscriptionRecord.
 */
export async function renewSubscription(
  config: TokenProviders,
  existingRecord: SubscriptionRecord,
  additionalCredits: bigint,
): Promise<{ coin: ShieldedCoin; txHash: string }> {
  if (additionalCredits < 1n) {
    throw new Error('SUBSCRIPTION_INVALID_AMOUNT');
  }

  const recipient = { bytes: existingRecord.recipientBytes };
  const { coin, txHash } = await mintCapabilityTokens(
    config,
    existingRecord.subscriptionKey,
    recipient,
    additionalCredits,
  );

  return { coin, txHash };
}
