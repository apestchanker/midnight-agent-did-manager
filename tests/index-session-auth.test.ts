import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import type { Server } from "http";

// Task 7: requireSession / /api/auth/nonce / /api/auth/session wiring into
// server/index.js. Unlike the other route-level test files in this project
// (which test service-function logic directly), these tests exercise the
// REAL server/index.js HTTP layer end-to-end — a real http.Server listening
// on an ephemeral port — because the acceptance criteria are specifically
// about status codes, gating order, and rate limiting, which only exist at
// the HTTP layer. Heavy service modules are mocked exactly like
// tests/index-routes.test.ts / tests/integration.test.ts already do.

vi.mock("../server/load-env.js", () => ({}));
vi.mock("../server/log-store.js", () => ({
  getRecentLogs: vi.fn(() => []),
  installProcessLogger: vi.fn(),
}));

const queryMock = vi.fn(async () => ({ rows: [] }));
vi.mock("../server/db.js", () => ({
  query: queryMock,
  withTransaction: vi.fn(),
  initializeDatabase: vi.fn(async () => {}),
}));

const mockIssueNonce = vi.fn();
const mockCreateSessionFromSignature = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("../server/session-service.js", async () => {
  const actual =
    await vi.importActual<typeof import("../server/session-service.js")>(
      "../server/session-service.js",
    );
  return {
    AuthError: actual.AuthError,
    issueNonce: mockIssueNonce,
    createSessionFromSignature: mockCreateSessionFromSignature,
    validateSession: mockValidateSession,
  };
});

const mockApproveDidRequestByHuman = vi.fn(async (input: Record<string, unknown>) => ({
  id: "did-request-1",
  ...input,
}));
const mockRejectDidRequestByHuman = vi.fn(async (input: Record<string, unknown>) => ({
  id: "did-request-1",
  ...input,
}));
const mockIssueApprovedDidRequest = vi.fn(async (input: Record<string, unknown>) => ({
  request: { id: "did-request-1", ...input },
  record: null,
}));
const mockRejectDidRequestByAdmin = vi.fn(async (input: Record<string, unknown>) => ({
  id: "did-request-1",
  ...input,
}));
const mockSaveAdminRegistryDeployment = vi.fn(async (input: Record<string, unknown>) => ({
  id: "deployment-1",
  ...input,
}));

vi.mock("../server/registry-service.js", () => ({
  approveDidRequestByHuman: mockApproveDidRequestByHuman,
  bootstrapDemoCustomer: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerMcpKey: vi.fn(),
  createDidRequest: vi.fn(),
  createWalletDidRequest: vi.fn(),
  createSubscription: vi.fn(),
  revokeCustomerMcpKey: vi.fn(),
  updateCustomerMcpKeyScopes: vi.fn(),
  getLatestAdminRegistryDeployment: vi.fn(),
  getCustomerByWallet: vi.fn(),
  getDidRequestById: vi.fn(),
  getPersistedDidState: vi.fn(),
  listRegistryDidRecords: vi.fn(),
  issueApprovedDidRequest: mockIssueApprovedDidRequest,
  linkWallet: vi.fn(),
  listDidRequests: vi.fn(),
  listAdminRegistryDeployments: vi.fn(),
  rejectDidRequestByAdmin: mockRejectDidRequestByAdmin,
  rejectDidRequestByHuman: mockRejectDidRequestByHuman,
  resolveDid: vi.fn(),
  saveAdminRegistryDeployment: mockSaveAdminRegistryDeployment,
  syncWalletIssuedDid: vi.fn(),
  syncWalletRevokedDid: vi.fn(),
  syncWalletUpdatedDid: vi.fn(),
  validateDid: vi.fn(),
}));

vi.mock("../server/proof-request-service.js", () => ({
  approveProofRequestByHuman: vi.fn(),
  createProofRequestForAgent: vi.fn(),
  createProofRequestForWallet: vi.fn(),
  deleteProofRequest: vi.fn(),
  getProofRequestById: vi.fn(),
  listProofRequests: vi.fn(),
  rejectProofRequestByHuman: vi.fn(),
  submitProofForRequest: vi.fn(),
}));

vi.mock("../server/vc-service.js", () => ({
  assembleSignedPresentation: vi.fn(),
  assembleUnifiedVP: vi.fn(),
  getCredentialBundle: vi.fn(),
  getIssuerDescriptor: vi.fn(),
  getMidnightProofMaterial: vi.fn(),
  listCredentialsForDid: vi.fn(),
  rotateCredentialsForDid: vi.fn(),
  verifyCredentialJwt: vi.fn(),
  verifyPresentation: vi.fn(),
}));

vi.mock("../server/midnight-proof-service.js", () => ({
  createMidnightProofRequest: vi.fn(),
  verifyMidnightProofSubmission: vi.fn(),
  verifyUnifiedVP: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };
const HUMAN_TOKEN = "human-session-token";
const ADMIN_TOKEN = "admin-session-token";
const HUMAN_WALLET = "mn_addr_preprod1holder";
const ADMIN_WALLET = "mn_addr_preprod1admin";

let server: Server;
let baseUrl: string;

function jsonHeaders(token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

beforeAll(async () => {
  process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
  const mod = await import("../server/index.js");
  server = mod.server;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  queryMock.mockClear();
  mockIssueNonce.mockReset();
  mockCreateSessionFromSignature.mockReset();
  mockValidateSession.mockReset();
  mockApproveDidRequestByHuman.mockClear();
  mockRejectDidRequestByHuman.mockClear();
  mockIssueApprovedDidRequest.mockClear();
  mockRejectDidRequestByAdmin.mockClear();
  mockSaveAdminRegistryDeployment.mockClear();

  mockValidateSession.mockImplementation(async (token: string) => {
    if (token === HUMAN_TOKEN) return { walletAddress: HUMAN_WALLET, isAdmin: false };
    if (token === ADMIN_TOKEN) return { walletAddress: ADMIN_WALLET, isAdmin: true };
    return null;
  });
});

afterEach(() => {
  process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
});

describe("source-level cutover check", () => {
  it("requireApiAuth is no longer defined and DID_API_AUTH_TOKEN is no longer compared anywhere in server/index.js", () => {
    const src = readFileSync("server/index.js", "utf-8");
    expect(src).not.toMatch(/function requireApiAuth\s*\(/);
    expect(src).not.toMatch(/process\.env\.DID_API_AUTH_TOKEN/);
    expect(src).toContain("async function requireSession(");
  });
});

describe("isPublicApiRoute", () => {
  it("returns true for POST /api/auth/nonce and POST /api/auth/session, false for previously-private routes", async () => {
    const { isPublicApiRoute } = await import("../server/index.js");
    const asUrl = (pathname: string) => new URL(`http://localhost${pathname}`);

    expect(
      isPublicApiRoute({ method: "POST" } as any, asUrl("/api/auth/nonce"), ["api", "auth", "nonce"]),
    ).toBe(true);
    expect(
      isPublicApiRoute({ method: "POST" } as any, asUrl("/api/auth/session"), ["api", "auth", "session"]),
    ).toBe(true);

    expect(
      isPublicApiRoute({ method: "GET" } as any, asUrl("/api/admin/logs"), ["api", "admin", "logs"]),
    ).toBe(false);
    expect(
      isPublicApiRoute(
        { method: "POST" } as any,
        asUrl("/api/human/did-requests/req-1/approve"),
        ["api", "human", "did-requests", "req-1", "approve"],
      ),
    ).toBe(false);
  });
});

describe("REQ-07 Scenario 01: legacy shared token no longer authenticates", () => {
  it("presenting only the old DID_API_AUTH_TOKEN value (no session) to a private route returns 401", async () => {
    process.env.DID_API_AUTH_TOKEN = "legacy-shared-secret";

    const response = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: { "x-did-api-key": "legacy-shared-secret" },
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
  });

  // FIX 3 (code review follow-up): getApiAuthToken previously read
  // X-DID-API-Key as an alternative to Authorization: Bearer. This test uses
  // a *valid* session token value (not garbage) sent ONLY via X-DID-API-Key,
  // with no Authorization header at all — before the fix, this would have
  // authenticated successfully (200); after the fix, the header is not read
  // at all, so it must be rejected exactly like an absent token (401).
  it("a valid session token sent only via X-DID-API-Key (no Authorization header) no longer authenticates", async () => {
    const response = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: { "x-did-api-key": ADMIN_TOKEN },
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
    expect(mockValidateSession).not.toHaveBeenCalledWith(ADMIN_TOKEN);
  });
});

describe("FIX 2: rate limiters key off X-Forwarded-For, not the shared proxy socket address", () => {
  it("keys the per-IP /api/auth/nonce rate limit off each request's X-Forwarded-For value, not the shared test-client socket address", async () => {
    mockIssueNonce.mockResolvedValue({
      challenge: "challenge-payload",
      nonce: "nonce-xff",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    // Every request below is made over the same loopback socket (127.0.0.1)
    // — simulating every real client sharing Render's single proxy IP — but
    // declares a distinct X-Forwarded-For value, simulating distinct real
    // clients behind that proxy. Before the fix (keying off
    // req.socket.remoteAddress), all 25 would land in one shared bucket and
    // the aggregate per-IP limit (20/60s) would trip well before the 25th.
    // After the fix, each simulated client gets its own budget, so none of
    // them should ever see a 429.
    for (let i = 0; i < 25; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/nonce`, {
        method: "POST",
        headers: { ...jsonHeaders(), "x-forwarded-for": `203.0.113.${i}, 10.0.0.1` },
        body: JSON.stringify({ walletAddress: `mn_addr_preprod1xffwallet${i}` }),
      });
      expect(response.status).toBe(200);
    }
  });

  it("keys the /api/auth/session rate limit off X-Forwarded-For too", async () => {
    const { AuthError } = await import("../server/session-service.js");
    mockCreateSessionFromSignature.mockRejectedValue(
      new AuthError("Wallet signature verification failed.", { code: "invalid_signature" }),
    );

    // 15 requests exceeds SESSION_RATE_LIMIT_MAX_REQUESTS (10), but each
    // declares a distinct X-Forwarded-For value, so none should share a
    // bucket and none should see a 429.
    for (let i = 0; i < 15; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        method: "POST",
        headers: { ...jsonHeaders(), "x-forwarded-for": `198.51.100.${i}` },
        body: JSON.stringify({
          signature: { data: `{"nonce":"xff-session-${i}"}`, signature: "s", verifyingKey: "v" },
        }),
      });
      expect(response.status).toBe(401);
      expect(response.status).not.toBe(429);
    }
  });
});

describe("REQ-04 Scenario 04: human-tier routes use the session wallet, not the body wallet", () => {
  it("POST /api/human/did-requests/:id/approve calls the service with req.session.walletAddress even when the body declares a different wallet", async () => {
    const response = await fetch(`${baseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(HUMAN_TOKEN),
      body: JSON.stringify({
        humanWalletAddress: "mn_addr_preprod1attacker",
        requestedDid: "did:midnight:preprod:c:agent",
      }),
    });

    expect(response.status).toBe(200);
    expect(mockApproveDidRequestByHuman).toHaveBeenCalledWith(
      expect.objectContaining({ humanWalletAddress: HUMAN_WALLET }),
    );
    expect(mockApproveDidRequestByHuman).not.toHaveBeenCalledWith(
      expect.objectContaining({ humanWalletAddress: "mn_addr_preprod1attacker" }),
    );
  });

  it("POST /api/human/did-requests/:id/reject calls the service with req.session.walletAddress", async () => {
    const response = await fetch(`${baseUrl}/api/human/did-requests/req-1/reject`, {
      method: "POST",
      headers: jsonHeaders(HUMAN_TOKEN),
      body: JSON.stringify({ humanWalletAddress: "mn_addr_preprod1attacker", reason: "no" }),
    });

    expect(response.status).toBe(200);
    expect(mockRejectDidRequestByHuman).toHaveBeenCalledWith(
      expect.objectContaining({ humanWalletAddress: HUMAN_WALLET }),
    );
  });

  it("rejects a human-tier route with no session at all (401) and does not call the service", async () => {
    const response = await fetch(`${baseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(mockApproveDidRequestByHuman).not.toHaveBeenCalled();
  });
});

describe("REQ-04 Scenario 03 / admin tier gating", () => {
  it("GET /api/admin/logs: a valid non-admin session receives 403", async () => {
    const response = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: jsonHeaders(HUMAN_TOKEN),
    });
    expect(response.status).toBe(403);
  });

  it("GET /api/admin/logs: a valid admin session succeeds", async () => {
    const response = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: jsonHeaders(ADMIN_TOKEN),
    });
    expect(response.status).toBe(200);
  });

  it("GET /api/admin/logs: admin route responds 503 when DID_ADMIN_WALLET_ADDRESS is unset, even with an admin-looking token", async () => {
    delete process.env.DID_ADMIN_WALLET_ADDRESS;
    const response = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: jsonHeaders(ADMIN_TOKEN),
    });
    expect(response.status).toBe(503);
  });

  it("POST /api/admin/registry-deployments: non-admin session receives 403; admin session succeeds and deployerWalletAddress comes from the session", async () => {
    const forbidden = await fetch(`${baseUrl}/api/admin/registry-deployments`, {
      method: "POST",
      headers: jsonHeaders(HUMAN_TOKEN),
      body: JSON.stringify({ contractAddress: "0xabc", networkId: "preprod" }),
    });
    expect(forbidden.status).toBe(403);
    expect(mockSaveAdminRegistryDeployment).not.toHaveBeenCalled();

    const ok = await fetch(`${baseUrl}/api/admin/registry-deployments`, {
      method: "POST",
      headers: jsonHeaders(ADMIN_TOKEN),
      body: JSON.stringify({
        contractAddress: "0xabc",
        networkId: "preprod",
        deployerWalletAddress: "mn_addr_preprod1attacker",
      }),
    });
    expect(ok.status).toBe(201);
    expect(mockSaveAdminRegistryDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ deployerWalletAddress: ADMIN_WALLET }),
    );
  });

  it("POST /api/admin/did-requests/:id/issue and /reject, DELETE /api/admin/proof-requests/:id all use the session wallet and require admin", async () => {
    const issue = await fetch(`${baseUrl}/api/admin/did-requests/req-1/issue`, {
      method: "POST",
      headers: jsonHeaders(ADMIN_TOKEN),
      body: JSON.stringify({ issuerWalletAddress: "mn_addr_preprod1attacker" }),
    });
    expect(issue.status).toBe(200);
    expect(mockIssueApprovedDidRequest).toHaveBeenCalledWith(
      expect.objectContaining({ issuerWalletAddress: ADMIN_WALLET }),
    );

    const reject = await fetch(`${baseUrl}/api/admin/did-requests/req-1/reject`, {
      method: "POST",
      headers: jsonHeaders(ADMIN_TOKEN),
      body: JSON.stringify({ adminWalletAddress: "mn_addr_preprod1attacker", reason: "no" }),
    });
    expect(reject.status).toBe(200);
    expect(mockRejectDidRequestByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ adminWalletAddress: ADMIN_WALLET }),
    );

    const nonAdminIssue = await fetch(`${baseUrl}/api/admin/did-requests/req-1/issue`, {
      method: "POST",
      headers: jsonHeaders(HUMAN_TOKEN),
      body: JSON.stringify({}),
    });
    expect(nonAdminIssue.status).toBe(403);
  });
});

describe("POST /api/auth/nonce rate limiting (OWASP A04 follow-up)", () => {
  it("allows requests within the threshold and returns 429 once exceeded, without issuing an extra nonce", async () => {
    mockIssueNonce.mockResolvedValue({
      challenge: "challenge-payload",
      nonce: "nonce-1",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const wallet = "mn_addr_preprod1ratelimited";

    for (let i = 0; i < 5; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/nonce`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ walletAddress: wallet }),
      });
      expect(response.status).toBe(200);
    }
    expect(mockIssueNonce).toHaveBeenCalledTimes(5);

    const limited = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: wallet }),
    });
    expect(limited.status).toBe(429);
    // issueNonce must not have been called for the rejected 6th request.
    expect(mockIssueNonce).toHaveBeenCalledTimes(5);
  });

  it("a different wallet address is not affected by another wallet's rate limit", async () => {
    mockIssueNonce.mockResolvedValue({
      challenge: "challenge-payload",
      nonce: "nonce-2",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const response = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: "mn_addr_preprod1freshwallet" }),
    });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/auth/nonce error redaction for unexpected issueNonce failures (code review follow-up, task 7-8)", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("redacts an unexpected issueNonce failure's message in production, matching the general catch-all's redaction posture", async () => {
    process.env.NODE_ENV = "production";
    mockIssueNonce.mockRejectedValueOnce(
      new Error('password authentication failed for user "postgres" at 10.0.4.12'),
    );

    const response = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: "mn_addr_preprod1errprod" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toBe("Internal server error.");
    expect(body.message).not.toMatch(/password|postgres|10\.0\.4\.12/i);
  });

  it("exposes the unexpected issueNonce failure's message in development, matching the general catch-all", async () => {
    process.env.NODE_ENV = "development";
    mockIssueNonce.mockRejectedValueOnce(
      new Error('password authentication failed for user "postgres" at 10.0.4.12'),
    );

    const response = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: "mn_addr_preprod1errdev" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toMatch(/password authentication failed/);
  });

  it("still returns the expected 400 invalid_wallet_address response for a validation AuthError, unaffected by the redaction fix", async () => {
    const { AuthError } = await import("../server/session-service.js");
    mockIssueNonce.mockRejectedValueOnce(
      new AuthError("A well-formed wallet address is required to request a challenge.", {
        code: "invalid_wallet_address",
        statusCode: 400,
      }),
    );

    const response = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: "not-a-wallet" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_wallet_address");
    expect(body.message).toBe("A well-formed wallet address is required to request a challenge.");
  });
});

// This describe block deliberately exhausts the shared per-IP nonce budget
// (see below), so it's placed last among the /api/auth/nonce-touching
// blocks in this file — nothing after it depends on that budget being
// available.
describe("POST /api/auth/nonce aggregate per-IP rate limiting (code review + security scan follow-up, tasks 7-8)", () => {
  it("eventually blocks purely by source IP even though every request declares a brand-new, never-reused wallet", async () => {
    mockIssueNonce.mockResolvedValue({
      challenge: "challenge-payload",
      nonce: "nonce-ip-wide",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    // The per-wallet limiter alone is bypassable from a single attacker IP
    // by rotating the client-declared walletAddress on every request (it
    // only has to match the loose Bech32m-ish shape — no proof of
    // ownership is checked at nonce-issuance time). A second, coarser
    // limiter keyed only by source IP must trip regardless of how many
    // distinct wallets are declared.
    //
    // This drains the budget rather than asserting an exact request count:
    // earlier tests in this file already spent some of the same per-IP
    // budget (127.0.0.1) before this describe block runs, and the fixed
    // rate-limit window (60s) is far longer than this whole suite takes to
    // run, so there's no reliable point to reset from. What's invariant
    // regardless of ambient consumption is that every single wallet used
    // below is brand-new and used exactly once — nowhere near the
    // per-wallet limit of 5 — so however many attempts it takes, a 429 can
    // only be explained by the aggregate per-IP limiter, never the
    // per-wallet one.
    const MAX_ATTEMPTS = 40;
    let blockedAtAttempt = -1;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/nonce`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ walletAddress: `mn_addr_preprod1ipwide${i}` }),
      });
      if (response.status === 429) {
        blockedAtAttempt = i;
        break;
      }
      expect(response.status).toBe(200);
    }

    expect(blockedAtAttempt).toBeGreaterThan(-1);

    // The block persists for a further fresh-wallet request too — it's a
    // fixed rate-limit window, not a one-shot trip.
    const stillBlocked = await fetch(`${baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ walletAddress: "mn_addr_preprod1ipwide-followup" }),
    });
    expect(stillBlocked.status).toBe(429);
    const body = await stillBlocked.json();
    expect(body.error).toBe("rate_limited");
  });
});

describe("POST /api/auth/session audit logging (OWASP A09 follow-up)", () => {
  it("writes an audit_events row with eventType auth_session_created on success", async () => {
    mockCreateSessionFromSignature.mockResolvedValueOnce({
      token: "opaque-token",
      walletAddress: HUMAN_WALLET,
      isAdmin: false,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    });

    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        signature: { data: "challenge-string", signature: "sig", verifyingKey: "vk" },
      }),
    });

    expect(response.status).toBe(200);
    const auditCall = queryMock.mock.calls.find(([sql]) =>
      /insert into audit_events/i.test(String(sql)),
    );
    expect(auditCall).toBeTruthy();
    const [, params] = auditCall as [string, unknown[]];
    expect(params).toContain("auth_session_created");
    expect(params).toContain(HUMAN_WALLET);
  });

  it("writes an audit_events row with eventType auth_session_denied and the failure reason for invalid_signature", async () => {
    const { AuthError } = await import("../server/session-service.js");
    const declaredWallet = "mn_addr_preprod1holder";
    mockCreateSessionFromSignature.mockRejectedValueOnce(
      new AuthError("Wallet signature verification failed.", { code: "invalid_signature" }),
    );

    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        signature: {
          data: JSON.stringify({ walletAddress: declaredWallet, nonce: "n1" }),
          signature: "bad-sig",
          verifyingKey: "vk",
        },
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("invalid_signature");

    const auditCall = queryMock.mock.calls.find(([sql]) =>
      /insert into audit_events/i.test(String(sql)),
    );
    expect(auditCall).toBeTruthy();
    const [, params] = auditCall as [string, unknown[]];
    expect(params).toContain("auth_session_denied");
    expect(params).toContain(declaredWallet);
  });

  it("maps nonce_already_used to 409 and wallet_address_mismatch to 401, both audited as auth_session_denied", async () => {
    const { AuthError } = await import("../server/session-service.js");

    mockCreateSessionFromSignature.mockRejectedValueOnce(
      new AuthError("This challenge has already been exchanged for a session.", {
        code: "nonce_already_used",
        statusCode: 409,
      }),
    );
    const replay = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ signature: { data: "{}", signature: "s", verifyingKey: "v" } }),
    });
    expect(replay.status).toBe(409);
    expect((await replay.json()).error).toBe("nonce_already_used");

    mockCreateSessionFromSignature.mockRejectedValueOnce(
      new AuthError("The signing wallet does not match the wallet declared when the challenge was requested.", {
        code: "wallet_address_mismatch",
      }),
    );
    const mismatch = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ signature: { data: "{}", signature: "s", verifyingKey: "v" } }),
    });
    expect(mismatch.status).toBe(401);
    expect((await mismatch.json()).error).toBe("wallet_address_mismatch");

    const auditEventTypes = queryMock.mock.calls
      .filter(([sql]) => /insert into audit_events/i.test(String(sql)))
      .map(([, params]) => (params as unknown[])[2]);
    expect(auditEventTypes.filter((t) => t === "auth_session_denied").length).toBeGreaterThanOrEqual(2);
  });
});

// Final security-scan gate follow-up (feature 007): POST /api/auth/session
// previously had no rate limiting of its own — only /api/auth/nonce did. A
// nonce obtained through the (already-limited) nonce endpoint stays valid
// for its whole TTL window, during which an attacker could retry arbitrary
// signature attempts against that same nonce with no cap at all; each
// attempt runs real signature-verification crypto inside
// createSessionFromSignature, making this an unauthenticated CPU-DoS
// amplification vector. This block is placed last among the
// /api/auth/session-touching describe blocks in this file (mirroring the
// nonce endpoint's own "aggregate per-IP" block further up) because it
// deliberately drains the shared per-IP budget for this endpoint — nothing
// after it may depend on that budget being available.
describe("POST /api/auth/session rate limiting (security scan follow-up, final gate)", () => {
  it("eventually blocks further exchange attempts with 429 by source IP, without the blocked attempt reaching createSessionFromSignature", async () => {
    const { AuthError } = await import("../server/session-service.js");
    mockCreateSessionFromSignature.mockRejectedValue(
      new AuthError("Wallet signature verification failed.", { code: "invalid_signature" }),
    );

    // Drains rather than asserting an exact count: earlier describe blocks
    // in this file already spent some of the same per-IP (127.0.0.1) budget
    // before this block runs, and the fixed rate-limit window (60s) is far
    // longer than this whole suite takes to run, so there's no reliable
    // point to reset from — same reasoning as the nonce endpoint's own
    // aggregate-by-IP test above.
    const MAX_ATTEMPTS = 20;
    let blockedAtAttempt = -1;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          signature: { data: `{"nonce":"rl-${i}"}`, signature: "s", verifyingKey: "v" },
        }),
      });
      if (response.status === 429) {
        blockedAtAttempt = i;
        break;
      }
      expect(response.status).toBe(401);
    }

    expect(blockedAtAttempt).toBeGreaterThan(-1);
    const callsBeforeFollowup = mockCreateSessionFromSignature.mock.calls.length;

    // The block persists for a further attempt too — it's a fixed
    // rate-limit window, not a one-shot trip — and the blocked attempt must
    // never reach createSessionFromSignature (i.e. no nonce-consumption
    // attempt is made for it).
    const stillBlocked = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        signature: { data: '{"nonce":"rl-followup"}', signature: "s", verifyingKey: "v" },
      }),
    });
    expect(stillBlocked.status).toBe(429);
    const body = await stillBlocked.json();
    expect(body.error).toBe("rate_limited");
    expect(mockCreateSessionFromSignature.mock.calls.length).toBe(callsBeforeFollowup);
  });
});
