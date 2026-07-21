import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import type { Server } from "http";
import { sha256Hex } from "../server/utils.js";

// Task 11: final integration task for 007-wallet-nonce-session-auth. Unlike
// every other test file in this feature (which mocks session-service.js
// and/or db.js at the boundary and asserts on already-known tokens), this
// file runs the REAL server/index.js, the REAL server/mcp-http.js, and the
// REAL server/session-service.js together against one shared in-memory fake
// Postgres (see createFakeDb below) — proving the actual nonce -> signature
// -> session -> protected-route pipeline works end-to-end, and that a
// session minted by one process is independently valid in the other, exactly
// as ADR-001 requires for the real two-process/shared-Postgres deployment.
//
// Only two things are mocked below db.js: the modules that would otherwise
// require a real database, a real registry, or real WASM-backed ZK/signature
// primitives unrelated to the auth flow itself (registry-service.js,
// proof-request-service.js, vc-service.js, midnight-proof-service.js), and
// @midnight-ntwrk/ledger-v8's verifySignature/addressFromKey — because
// server/index.js's /api/auth/session handler calls
// createSessionFromSignature(...) with no injected deps, so it always uses
// the real ledger-v8 exports unless the module itself is mocked.

vi.mock("../server/load-env.js", () => ({}));
vi.mock("../server/log-store.js", () => ({
  getRecentLogs: vi.fn(() => [{ level: "info", message: "hello" }]),
  installProcessLogger: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fake Postgres shared by BOTH real server/index.js and real
// server/mcp-http.js (both files `import { query, withTransaction } from
// "./db.js"`, which resolves to this one mocked module instance for the
// whole test file) — the same sharing relationship the two real Node
// processes have via the real Postgres database in production (ADR-001).
// session-service.js itself is NOT mocked — it runs for real against this
// fake store, so issueNonce/createSessionFromSignature/validateSession
// exercise their actual SQL-shaped logic.
// ---------------------------------------------------------------------------
function normalizeSql(sql: string) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createFakeDb() {
  const authNonces: Array<Record<string, unknown>> = [];
  const authSessions: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  let nonceSeq = 0;
  let sessionSeq = 0;

  async function query(sql: string, params: unknown[] = []) {
    const text = normalizeSql(sql);

    if (text.startsWith("insert into auth_nonces")) {
      const [nonce, wallet_address, challenge, expires_at] = params;
      const row = {
        id: `nonce-${(nonceSeq += 1)}`,
        nonce,
        wallet_address,
        challenge,
        expires_at,
        consumed_at: null,
      };
      authNonces.push(row);
      return { rows: [row] };
    }

    if (text.includes("select * from auth_nonces")) {
      const [nonce] = params;
      const row = authNonces.find((r) => r.nonce === nonce);
      return { rows: row ? [row] : [] };
    }

    if (text.includes("select * from auth_sessions")) {
      const [tokenHash] = params;
      const row = authSessions.find((r) => r.token_hash === tokenHash);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("update auth_sessions set last_used_at")) {
      const [id] = params;
      const row = authSessions.find((r) => r.id === id);
      if (row) row.last_used_at = new Date().toISOString();
      return { rows: [] };
    }

    if (text.startsWith("insert into audit_events")) {
      const [actorType, actorRef, eventType, entityType, entityId, eventData] = params;
      auditEvents.push({ actorType, actorRef, eventType, entityType, entityId, eventData });
      return { rows: [] };
    }

    return { rows: [] };
  }

  async function withTransaction(run: (client: { query: typeof query }) => unknown) {
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const text = normalizeSql(sql);

        if (text.startsWith("update auth_nonces set consumed_at")) {
          const [nonce] = params;
          const row = authNonces.find((r) => r.nonce === nonce && !r.consumed_at);
          if (!row) return { rows: [] };
          row.consumed_at = new Date().toISOString();
          return { rows: [row] };
        }

        if (text.startsWith("insert into auth_sessions")) {
          const [tokenHash, walletAddress, expiresAt] = params;
          const row = {
            id: `session-${(sessionSeq += 1)}`,
            token_hash: tokenHash,
            wallet_address: walletAddress,
            expires_at: expiresAt,
            revoked_at: null,
            last_used_at: null,
          };
          authSessions.push(row);
          return { rows: [row] };
        }

        return query(sql, params);
      },
    };
    return run(client);
  }

  return { query, withTransaction, authNonces, authSessions, auditEvents };
}

const fakeDb = createFakeDb();
vi.mock("../server/db.js", () => ({
  query: (sql: string, params?: unknown[]) => fakeDb.query(sql, params),
  withTransaction: (run: (client: unknown) => unknown) => fakeDb.withTransaction(run as never),
  initializeDatabase: vi.fn(async () => {}),
}));

// server/session-service.js is deliberately NOT mocked in this file — the
// whole point of the test is to exercise it for real. Only the underlying
// crypto primitives it calls (and does not receive as injectable deps from
// the HTTP route handlers) are mocked, same pattern already used by
// tests/vc-service.test.ts / tests/providers-reconnect.test.ts for the same
// package.
const verifySignatureMock = vi.fn(() => true);
const addressFromKeyMock = vi.fn(() => "");
vi.mock("@midnight-ntwrk/ledger-v8", () => ({
  verifySignature: (...args: unknown[]) => verifySignatureMock(...args),
  addressFromKey: (...args: unknown[]) => addressFromKeyMock(...args),
}));

const mockCreateDidRequest = vi.fn(async (input: Record<string, unknown>) => {
  if (input.mcpKey !== "mcp_valid_agent_key") {
    throw new Error("Invalid or expired MCP key.");
  }
  return {
    id: "agent-request-1",
    customer_id: "customer-1",
    request_status: "pending_human_approval",
    ...input,
  };
});
const mockApproveDidRequestByHuman = vi.fn(async (input: Record<string, unknown>) => ({
  id: "did-request-1",
  ...input,
}));

vi.mock("../server/registry-service.js", () => ({
  approveDidRequestByHuman: mockApproveDidRequestByHuman,
  authenticateMcpKey: vi.fn(async (key: string) => {
    if (key !== "mcp_valid_agent_key") return null;
    return { id: "key-1", customer_id: "customer-1", label: "agent-key", scopes: [] };
  }),
  bootstrapDemoCustomer: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerMcpKey: vi.fn(),
  createDidRequest: mockCreateDidRequest,
  createWalletDidRequest: vi.fn(),
  createSubscription: vi.fn(),
  recordActionTokenGrant: vi.fn(),
  revokeCustomerMcpKey: vi.fn(),
  updateCustomerMcpKeyScopes: vi.fn(),
  getLatestAdminRegistryDeployment: vi.fn(),
  getCustomerByWallet: vi.fn(),
  getCustomerContextById: vi.fn(),
  getDidRequestById: vi.fn(),
  getPersistedDidState: vi.fn(),
  listRegistryDidRecords: vi.fn(),
  issueApprovedDidRequest: vi.fn(async (input: Record<string, unknown>) => ({
    request: { id: "did-request-1", ...input },
    record: null,
  })),
  linkWallet: vi.fn(),
  listDidRequests: vi.fn(),
  listAdminRegistryDeployments: vi.fn(),
  rejectDidRequestByAdmin: vi.fn(async (input: Record<string, unknown>) => ({
    id: "did-request-1",
    ...input,
  })),
  rejectDidRequestByHuman: vi.fn(async (input: Record<string, unknown>) => ({
    id: "did-request-1",
    ...input,
  })),
  resolveDid: vi.fn(),
  saveAdminRegistryDeployment: vi.fn(async (input: Record<string, unknown>) => ({
    id: "deployment-1",
    ...input,
  })),
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
const HUMAN_WALLET = "mn_addr_preprod1flowholder";
const ADMIN_WALLET = "mn_addr_preprod1flowadmin";

let indexServer: Server;
let indexBaseUrl: string;
let mcpServer: Server;
let mcpBaseUrl: string;

async function listenOnEphemeralPort(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function jsonHeaders(token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function login(baseUrl: string, walletAddress: string) {
  const nonceResponse = await fetch(`${baseUrl}/api/auth/nonce`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ walletAddress }),
  });
  expect(nonceResponse.status).toBe(200);
  const { challenge } = await nonceResponse.json();

  addressFromKeyMock.mockReturnValue(walletAddress);
  verifySignatureMock.mockReturnValue(true);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      signature: { data: challenge, signature: "aa", verifyingKey: "bb" },
    }),
  });
  expect(sessionResponse.status).toBe(200);
  return sessionResponse.json();
}

beforeAll(async () => {
  process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
  process.env.DID_AUTH_NONCE_TTL_SECONDS = "300";
  process.env.DID_SESSION_TTL_SECONDS = "1800";

  const indexMod = await import("../server/index.js");
  indexServer = indexMod.server;
  indexBaseUrl = await listenOnEphemeralPort(indexServer);

  const mcpMod = await import("../server/mcp-http.js");
  mcpServer = mcpMod.server;
  mcpBaseUrl = await listenOnEphemeralPort(mcpServer);
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => indexServer.close(() => resolve())),
    new Promise<void>((resolve) => mcpServer.close(() => resolve())),
  ]);
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  mockApproveDidRequestByHuman.mockClear();
  mockCreateDidRequest.mockClear();
  verifySignatureMock.mockReset().mockReturnValue(true);
  addressFromKeyMock.mockReset().mockReturnValue("");
  process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
});

describe("full nonce -> signature -> session -> protected-route flow (REQ-01, REQ-02, REQ-03, REQ-04)", () => {
  it("a human wallet logging in for real can call a human-tier route but not an admin-tier route", async () => {
    const session = await login(indexBaseUrl, HUMAN_WALLET);
    expect(session.walletAddress).toBe(HUMAN_WALLET);
    expect(session.isAdmin).toBe(false);
    expect(typeof session.token).toBe("string");
    expect(session.token.length).toBeGreaterThan(0);

    const approve = await fetch(`${indexBaseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(session.token),
      body: JSON.stringify({ requestedDid: "did:midnight:preprod:c:agent" }),
    });
    expect(approve.status).toBe(200);
    expect(mockApproveDidRequestByHuman).toHaveBeenCalledWith(
      expect.objectContaining({ humanWalletAddress: HUMAN_WALLET }),
    );

    const adminAttempt = await fetch(`${indexBaseUrl}/api/admin/logs`, {
      headers: jsonHeaders(session.token),
    });
    expect(adminAttempt.status).toBe(403);
  });

  it("the wallet configured as DID_ADMIN_WALLET_ADDRESS, logging in through the SAME flow, gets an admin session", async () => {
    const session = await login(indexBaseUrl, ADMIN_WALLET);
    expect(session.walletAddress).toBe(ADMIN_WALLET);
    expect(session.isAdmin).toBe(true);

    const adminLogs = await fetch(`${indexBaseUrl}/api/admin/logs`, {
      headers: jsonHeaders(session.token),
    });
    expect(adminLogs.status).toBe(200);
  });
});

describe("REQ-07 Scenario 01: legacy shared token rejected on both processes", () => {
  it("the old DID_API_AUTH_TOKEN value alone (no session) is rejected with 401 on server/index.js", async () => {
    process.env.DID_API_AUTH_TOKEN = "legacy-shared-secret";
    const response = await fetch(`${indexBaseUrl}/api/admin/logs`, {
      headers: { "x-did-api-key": "legacy-shared-secret" },
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("unauthorized");
  });

  it("the old DID_API_AUTH_TOKEN value alone (no session) is rejected with 401 on server/mcp-http.js GET /logs", async () => {
    process.env.DID_API_AUTH_TOKEN = "legacy-shared-secret";
    const response = await fetch(`${mcpBaseUrl}/logs`, {
      headers: { "x-did-api-key": "legacy-shared-secret" },
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("unauthorized");
  });
});

describe("REQ-07 Scenario 02: agent key mechanism is unaffected", () => {
  it("POST /api/agent/did-requests with a valid mcp_key still succeeds, with no session/Authorization header at all", async () => {
    const response = await fetch(`${indexBaseUrl}/api/agent/did-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mcp-key": "mcp_valid_agent_key" },
      body: JSON.stringify({
        organizationDisclosure: "undisclosed",
        requestPayload: { agentName: "Agent One" },
      }),
    });
    expect(response.status).toBe(201);
    expect(mockCreateDidRequest).toHaveBeenCalledWith(
      expect.objectContaining({ mcpKey: "mcp_valid_agent_key" }),
    );
  });
});

describe("cross-process session sharing (ADR-001): a session minted via server/index.js is usable by server/mcp-http.js", () => {
  it("an admin session token issued by server/index.js's /api/auth/session is accepted by server/mcp-http.js's requireSession for GET /logs", async () => {
    const session = await login(indexBaseUrl, ADMIN_WALLET);

    const mcpLogs = await fetch(`${mcpBaseUrl}/logs`, {
      headers: jsonHeaders(session.token),
    });
    expect(mcpLogs.status).toBe(200);
    const body = await mcpLogs.json();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("a non-admin session token issued by server/index.js is rejected with 403 by server/mcp-http.js's admin-only /logs", async () => {
    const session = await login(indexBaseUrl, HUMAN_WALLET);

    const mcpLogs = await fetch(`${mcpBaseUrl}/logs`, {
      headers: jsonHeaders(session.token),
    });
    expect(mcpLogs.status).toBe(403);
  });
});

describe("source-level cutover confirmation (recorded per task 11's acceptance criteria)", () => {
  it("server/index.js has no remaining requireApiAuth definition or DID_API_AUTH_TOKEN comparison for human/admin routes", () => {
    const src = readFileSync("server/index.js", "utf-8");
    expect(src).not.toMatch(/function requireApiAuth\s*\(/);
    expect(src).not.toMatch(/process\.env\.DID_API_AUTH_TOKEN/);
    expect(src).toContain("async function requireSession(");
  });

  it("server/mcp-http.js has no remaining requireApiAuth definition or DID_API_AUTH_TOKEN comparison", () => {
    const src = readFileSync("server/mcp-http.js", "utf-8");
    expect(src).not.toMatch(/function requireApiAuth\s*\(/);
    expect(src).not.toMatch(/process\.env\.DID_API_AUTH_TOKEN/);
    expect(src).toContain("async function requireSession(");
  });
});

// sdd-verifier gap (REQ-05 Scenarios 01/02): the prior test suite only
// unit-tested expiration at the validateSession() level
// (tests/session-service.test.ts). This file is the right place to close
// that gap end-to-end over real HTTP, because — unlike
// tests/index-session-auth.test.ts, which mocks validateSession entirely —
// server/session-service.js is NOT mocked here, so a real bearer token is
// checked by the real validateSession against the real (fake-backed)
// auth_sessions row, exactly as it would be in production. The fake
// Postgres row is mutated directly (bypassing the normal expiry-by-waiting,
// which would make this test slow and TTL-config-dependent) to simulate
// wall-clock time having passed beyond the session's expires_at.
describe("REQ-05 Scenario 01: expired session is rejected end-to-end over real HTTP", () => {
  it("a well-formed bearer token whose session has expired is rejected with 401 on a real protected route, and the underlying action does not occur", async () => {
    const session = await login(indexBaseUrl, HUMAN_WALLET);

    const tokenHash = sha256Hex(session.token);
    const row = fakeDb.authSessions.find((entry) => entry.token_hash === tokenHash);
    expect(row).toBeTruthy();
    (row as Record<string, unknown>).expires_at = new Date(Date.now() - 1_000).toISOString();

    mockApproveDidRequestByHuman.mockClear();
    const response = await fetch(`${indexBaseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(session.token),
      body: JSON.stringify({ requestedDid: "did:midnight:preprod:c:agent" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
    // The token is well-formed (it came from a real login) — this must be
    // rejected purely on expires_at, and the approval action itself must
    // never have run.
    expect(mockApproveDidRequestByHuman).not.toHaveBeenCalled();
  });
});

describe("REQ-05 Scenario 02: re-authentication after expiration recovers access", () => {
  it("repeating the challenge-response flow for the same wallet after its session expired issues a new session that works on a protected route", async () => {
    const expiredSession = await login(indexBaseUrl, HUMAN_WALLET);
    const tokenHash = sha256Hex(expiredSession.token);
    const row = fakeDb.authSessions.find((entry) => entry.token_hash === tokenHash);
    expect(row).toBeTruthy();
    (row as Record<string, unknown>).expires_at = new Date(Date.now() - 1_000).toISOString();

    const expiredAttempt = await fetch(`${indexBaseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(expiredSession.token),
      body: JSON.stringify({ requestedDid: "did:midnight:preprod:c:agent" }),
    });
    expect(expiredAttempt.status).toBe(401);

    // REQ-01/REQ-02 again, for the same wallet, after the previous session
    // expired — this is "the wallet holder is not left in an unrecoverable
    // state" being asserted for real, not just re-derived from mocks.
    const freshSession = await login(indexBaseUrl, HUMAN_WALLET);
    expect(freshSession.walletAddress).toBe(HUMAN_WALLET);
    expect(freshSession.token).not.toBe(expiredSession.token);

    mockApproveDidRequestByHuman.mockClear();
    const response = await fetch(`${indexBaseUrl}/api/human/did-requests/req-1/approve`, {
      method: "POST",
      headers: jsonHeaders(freshSession.token),
      body: JSON.stringify({ requestedDid: "did:midnight:preprod:c:agent" }),
    });

    expect(response.status).toBe(200);
    expect(mockApproveDidRequestByHuman).toHaveBeenCalledWith(
      expect.objectContaining({ humanWalletAddress: HUMAN_WALLET }),
    );
  });
});
