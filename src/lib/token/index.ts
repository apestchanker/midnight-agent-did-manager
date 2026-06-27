/**
 * Public API barrel for the shielded capability token module.
 */

// State manager
export { TokenStateManager } from './token-state.js';

// Witness functions, orchestrator, and providers interface
export {
  mintCapabilityTokens,
  consumeTokenForAction,
  executeGatedAction,
} from './token-witness.js';
export type { TokenProviders } from './token-witness.js';

// Subscription flows (admin)
export { generateSubscriptionKey, grantSubscription, renewSubscription } from './subscription.js';

// Types
export type {
  ShieldedCoin,
  TokenMintRecord,
  SubscriptionRecord,
  TokenBalance,
  CapabilityProof,
  ActionType,
  TokenCapabilityPrivateState,
} from './token-types.js';

// Constants and utilities
export { ACTION_TYPE_BYTES, TOKEN_STATE_SLOT, padTo32 } from './token-types.js';
