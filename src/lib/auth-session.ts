import type { AuthSession } from "../types/service";

/**
 * REQ-06 (feature 007-wallet-nonce-session-auth): administrator UI must be
 * gated strictly by the server-determined `isAdmin` field of the
 * authenticated wallet session — never by comparing the connected wallet
 * against a client-side configured address (e.g.
 * VITE_ADMIN_WALLET_SHIELDED_ADDR), even when that client-side value happens
 * to reference the same wallet for unrelated display purposes. Before login
 * completes (session is null), this always returns false.
 */
export function isAdminSession(session: AuthSession | null): boolean {
  return Boolean(session?.isAdmin);
}
