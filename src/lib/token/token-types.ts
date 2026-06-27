/**
 * TypeScript types for the shielded capability token module.
 * Mirrors the Compact types defined in contracts/token_gating.compact.
 */

// ─── Core coin types ─────────────────────────────────────────────────────────

export type ShieldedCoin = {
  /** Unique nonce used to derive the coin commitment */
  nonce: Uint8Array;
  /** Token color (domain-separated, contract-bound) */
  color: Uint8Array;
  /** Number of remaining capability credits (BigInt) */
  value: bigint;
  /** Address of the token_gating contract that minted this coin */
  contractAddress: string;
};

// ─── Mint record ─────────────────────────────────────────────────────────────

export type TokenMintRecord = {
  subscriptionKey: Uint8Array;
  recipientBytes: Uint8Array;
  contractAddress: string;
  mintedAt: string; // ISO-8601
};

// ─── Action types ─────────────────────────────────────────────────────────────

export type ActionType =
  | "self_register_did"
  | "request_update_did"
  | "grant_role"
  | "revoke_role"
  | "revoke_did";

/**
 * Pad a UTF-8 string to exactly 32 bytes (zero-padded on the right),
 * matching the semantics of Compact's pad(32, "…") built-in.
 */
export function padTo32(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  const result = new Uint8Array(32);
  result.set(encoded.subarray(0, 32));
  return result;
}

/** Pre-computed 32-byte representations of each ActionType. */
export const ACTION_TYPE_BYTES: Record<ActionType, Uint8Array> = {
  self_register_did: padTo32("self_register_did"),
  request_update_did: padTo32("request_update_did"),
  grant_role: padTo32("grant_role"),
  revoke_role: padTo32("revoke_role"),
  revoke_did: padTo32("revoke_did"),
};

// ─── Capability proof ─────────────────────────────────────────────────────────

export type CapabilityProof = {
  /** Nullifier computed by the token_gating.consume_token_for_action circuit */
  nullifier: Uint8Array;
  /** Commitment value stored on-chain in capability_commitments */
  commitmentValue: Uint8Array;
  /** The action this proof authorises */
  actionType: ActionType;
  /** DID key of the subject that owns the capability */
  didKey: Uint8Array;
  /** Contract address of the token_gating contract */
  tokenContractAddress: string;
  /**
   * Color of the coin spent in consume_token_for_action.
   * Required when calling self_register_did (v2: token_color circuit param).
   * Also embedded in the commitment: hash([action, contract, did_key, coin_color]).
   */
  coinColor: Uint8Array;
};

// ─── Subscription record ─────────────────────────────────────────────────────

/** Created by the admin when granting a subscription to a user. */
export type SubscriptionRecord = {
  /** Unique 32-byte key used to derive the token color on-chain. */
  subscriptionKey: Uint8Array;
  /** User's ZswapCoinPublicKey.bytes — who received the tokens. */
  recipientBytes: Uint8Array;
  /** Credits granted (excludes the anchor unit). */
  creditsGranted: bigint;
  /** Address of the token_gating contract. */
  contractAddress: string;
  grantedAt: string; // ISO-8601
};

// ─── Token balance ────────────────────────────────────────────────────────────

export type TokenBalance = {
  /** Total usable credits remaining across all spendable coins. */
  spendableCredits: bigint;
  /** Whether the wallet holds the permanent anchor coin (value=1). */
  hasAnchor: boolean;
  /** True when spendableCredits > 0 — the user can execute a gated action. */
  canAct: boolean;
  /** Total number of shielded coins in the wallet (including anchor). */
  totalCoins: number;
};

// ─── Private state ────────────────────────────────────────────────────────────

/** Key used to store/retrieve TokenCapabilityPrivateState in the private-state provider. */
export const TOKEN_STATE_SLOT = "token-capability-state-v1";

export type TokenCapabilityPrivateState = {
  /** All shielded coins currently held (including the anchor). */
  coins: ShieldedCoin[];
  /** History of minting operations (used for color derivation). */
  mintRecords: TokenMintRecord[];
  /** Capability proofs computed but not yet submitted to the DID registry. */
  pendingProofs: CapabilityProof[];
};
