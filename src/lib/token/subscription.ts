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
 * Generates a deterministic 32-byte subscription key from an identity string and
 * a rotation marker. The admin uses this as the `subscriptionKey` parameter for
 * `mint_capability_tokens`, which derives the token color from it
 * (`tokenType(persistentHash(subscriptionKey), contract)`).
 *
 * The key MUST be stable for a given identity so that repeated grants to the
 * same recipient land on the same color and top up their existing credits.
 * Deriving it from a timestamp (the previous behaviour) minted a brand-new,
 * separately-tracked color on every grant and fragmented recipients' wallets.
 *
 * @param identity - stable identity string, e.g. `"<recipientCoinPublicKeyHex>:<contractAddress>"`
 * @param rotation - bump this (string or number) only to deliberately move the
 *                   recipient onto a fresh color, e.g. after revoking a subscription.
 *                   Defaults to `0` (stable color).
 */
export function generateSubscriptionKey(
  identity: string,
  rotation: string | number = 0,
): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`${identity}:${rotation}`).digest()
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
 * @param _userId - Opaque user identifier; retained for call-site compatibility.
 *                  The color is derived from the recipient + contract, not this.
 * @param userRecipient - User's ZswapCoinPublicKey (shielded address bytes)
 * @param creditsToGrant - Number of usable capability credits (circuit mints this + 1 anchor)
 * @param rotation - bump only to deliberately move the recipient onto a fresh color (default 0)
 */
export async function grantSubscription(
  config: TokenProviders,
  _userId: string,
  userRecipient: { bytes: Uint8Array },
  creditsToGrant: bigint,
  rotation: string | number = 0,
): Promise<GrantSubscriptionResult> {
  if (creditsToGrant < 1n) {
    throw new Error('SUBSCRIPTION_INVALID_AMOUNT');
  }

  // Stable per (recipient, contract) so repeated grants top up one color.
  const identity = `${Buffer.from(userRecipient.bytes).toString('hex')}:${config.stateManager.contractAddress}`;
  const subscriptionKey = generateSubscriptionKey(identity, rotation);

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
    grantedAt: new Date().toISOString(),
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
