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

/**
 * Guard for effects that call session-gated API routes
 * (/api/registry/dids, /api/customers/by-wallet, /api/did-requests, ...).
 *
 * These routes are absent from isPublicApiRoute() in server/index.js, so they
 * answer 401 unless the request carries `Authorization: Bearer <token>`.
 * serviceApi holds that token in memory only (ADR-002), which means every
 * page load starts with no session and only acquires one after login()
 * finishes a nonce -> sign -> session round trip gated on a wallet signature.
 *
 * An effect keyed solely on data that is ready *before* that round trip —
 * a contract address from config, a wallet address from connect — therefore
 * fires too early and 401s. Requiring the session here, and listing it as an
 * effect dependency, both suppresses the doomed call and re-runs the effect
 * once the session lands.
 *
 * `requiredInputs` are the effect's own non-auth prerequisites; blank or
 * whitespace-only values are treated as absent, matching the `.trim()` checks
 * these call sites already used.
 */
export function canLoadSessionScopedData(
  session: AuthSession | null,
  ...requiredInputs: Array<string | null | undefined>
): boolean {
  if (!session?.token?.trim()) return false;
  return requiredInputs.every((input) => Boolean(input && input.trim()));
}
