import { describe, expect, it } from "vitest";
import { canLoadSessionScopedData } from "../src/lib/auth-session";
import type { AuthSession } from "../src/types/service";

// Regression cover for the 401 storm seen on the deployed site: the registry
// DID directory, the customer lookup and the pending-review queue all fired
// before login() had produced a session, so /api/registry/dids,
// /api/customers/by-wallet and /api/did-requests each answered 401.
//
// The registry-DID effect was the damaging one — it keys off a contract
// address that is ready at mount, and its only other trigger is
// didRecord.status changing, so a single early 401 left the DID directory
// empty for the rest of the page's life.

const session: AuthSession = {
  token: "session-token-abc",
  walletAddress: "mn_addr_preprod1wallet",
  isAdmin: false,
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const CONTRACT = "137beb85b49c6c93ecde14a0ec76367cb682c72454098e74dafeab253d9617d5";

describe("canLoadSessionScopedData", () => {
  it("blocks the call while the session is still null", () => {
    // The exact reported failure: contract address ready at mount, no session
    // yet, so GET /api/registry/dids would 401.
    expect(canLoadSessionScopedData(null, CONTRACT)).toBe(false);
  });

  it("allows the call once a session exists and inputs are present", () => {
    expect(canLoadSessionScopedData(session, CONTRACT)).toBe(true);
  });

  it("blocks while a wallet is connected but login has not finished", () => {
    // Wallet connect populates walletAddress immediately; the nonce -> sign ->
    // session round trip lands later. This is the window that produced the
    // /api/customers/by-wallet and /api/did-requests 401s.
    expect(canLoadSessionScopedData(null, session.walletAddress)).toBe(false);
  });

  it("still requires the effect's own inputs even with a valid session", () => {
    expect(canLoadSessionScopedData(session, "")).toBe(false);
    expect(canLoadSessionScopedData(session, undefined)).toBe(false);
    expect(canLoadSessionScopedData(session, null)).toBe(false);
  });

  it("treats whitespace-only inputs as absent, matching the previous .trim() checks", () => {
    expect(canLoadSessionScopedData(session, "   ")).toBe(false);
  });

  it("requires every input when an effect depends on more than one", () => {
    expect(canLoadSessionScopedData(session, CONTRACT, session.walletAddress)).toBe(true);
    expect(canLoadSessionScopedData(session, CONTRACT, "")).toBe(false);
  });

  it("rejects a session carrying a blank token, which would send an empty Bearer header", () => {
    expect(canLoadSessionScopedData({ ...session, token: "" }, CONTRACT)).toBe(false);
    expect(canLoadSessionScopedData({ ...session, token: "   " }, CONTRACT)).toBe(false);
  });

  it("does not depend on isAdmin — non-admin sessions read their own scoped data", () => {
    expect(canLoadSessionScopedData({ ...session, isAdmin: false }, CONTRACT)).toBe(true);
    expect(canLoadSessionScopedData({ ...session, isAdmin: true }, CONTRACT)).toBe(true);
  });

  it("permits a call that has no inputs beyond the session itself", () => {
    expect(canLoadSessionScopedData(session)).toBe(true);
    expect(canLoadSessionScopedData(null)).toBe(false);
  });
});
