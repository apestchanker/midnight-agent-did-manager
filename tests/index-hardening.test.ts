import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";

// Covers the three API-server hardening changes:
//   (b) rate limiting on the unauthenticated compute endpoints
//   (c) Origin validation with 403
//   (d) agent MCP key accepted from the X-MCP-Key header only
//
// Mock surface mirrors tests/index-session-auth.test.ts — each of these
// route-level test files declares its own, since server/index.js pulls in the
// whole service layer at import time.

vi.mock("../server/load-env.js", () => ({}));
vi.mock("../server/log-store.js", () => ({
  getRecentLogs: vi.fn(() => []),
  installProcessLogger: vi.fn(),
}));
vi.mock("../server/db.js", () => ({
  query: vi.fn(async () => ({ rows: [] })),
  withTransaction: vi.fn(),
  initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("../server/session-service.js", () => ({
  issueNonce: vi.fn(),
  createSessionFromSignature: vi.fn(),
  validateSession: vi.fn(async () => null),
  revokeSession: vi.fn(),
}));

const mockCreateDidRequest = vi.fn(async (input: Record<string, unknown>) => ({
  id: "request-1",
  ...input,
}));
const mockResolveDid = vi.fn(async (did: string) => ({ did, didDocument: { id: did } }));

vi.mock("../server/registry-service.js", () => ({
  approveDidRequestByHuman: vi.fn(),
  bootstrapDemoCustomer: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerMcpKey: vi.fn(),
  createDidRequest: mockCreateDidRequest,
  createWalletDidRequest: vi.fn(),
  createSubscription: vi.fn(),
  revokeCustomerMcpKey: vi.fn(),
  updateCustomerMcpKeyScopes: vi.fn(),
  getLatestAdminRegistryDeployment: vi.fn(),
  getCustomerByWallet: vi.fn(),
  getCustomerContextById: vi.fn(),
  getDidRequestById: vi.fn(),
  getPersistedDidState: vi.fn(),
  listRegistryDidRecords: vi.fn(),
  issueApprovedDidRequest: vi.fn(),
  issueDidRequest: vi.fn(),
  listCustomers: vi.fn(),
  listDidRequests: vi.fn(),
  recordRegistryDeployment: vi.fn(),
  rejectDidRequestByHuman: vi.fn(),
  resolveDid: mockResolveDid,
  revokeDid: vi.fn(),
  updateDidRequestStatus: vi.fn(),
  validateDid: vi.fn(async (did: string) => ({ did, valid: true })),
  addCustomerWallet: vi.fn(),
  createActionTokenGrant: vi.fn(),
  listActionTokenGrants: vi.fn(),
}));
vi.mock("../server/proof-request-service.js", () => ({
  approveProofRequestByHuman: vi.fn(),
  createProofRequestForAgent: vi.fn(async (input: Record<string, unknown>) => ({ id: "pr-1", ...input })),
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
  getIssuerDescriptor: vi.fn(async () => ({ id: "did:web:issuer.example" })),
  getMidnightProofMaterial: vi.fn(),
  listCredentialsForDid: vi.fn(),
  rotateCredentialsForDid: vi.fn(),
  verifyCredentialJwt: vi.fn(async () => ({ valid: true })),
  verifyPresentation: vi.fn(async () => ({ valid: true })),
}));
vi.mock("../server/midnight-proof-service.js", () => ({
  createMidnightProofRequest: vi.fn(),
  verifyMidnightProofSubmission: vi.fn(async () => ({ valid: true })),
  verifyUnifiedVP: vi.fn(async () => ({ valid: true })),
}));

const ALLOWED_ORIGIN = "https://multipass-site.onrender.com";
const ORIGINAL_ENV = { ...process.env };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.DID_CORS_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
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
  mockCreateDidRequest.mockClear();
});

// Each test gets its own source IP so the per-IP rate-limit buckets from one
// test can never bleed into another.
let ipCounter = 0;
function freshIpHeaders(extra: Record<string, string> = {}) {
  ipCounter += 1;
  return { "x-forwarded-for": `203.0.113.${ipCounter}`, ...extra };
}

describe("(c) Origin validation", () => {
  it("allows a request with no Origin header (agents, curl, health checks)", async () => {
    const response = await fetch(`${baseUrl}/health`, { headers: freshIpHeaders() });
    expect(response.status).toBe(200);
  });

  it("allows an Origin on the allowlist", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: freshIpHeaders({ origin: ALLOWED_ORIGIN }),
    });
    expect(response.status).toBe(200);
  });

  it("rejects a disallowed Origin with 403", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: freshIpHeaders({ origin: "https://evil.example.com" }),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden_origin");
  });

  it("rejects a disallowed Origin on the preflight too", async () => {
    const response = await fetch(`${baseUrl}/api/issuer`, {
      method: "OPTIONS",
      headers: freshIpHeaders({
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      }),
    });
    expect(response.status).toBe(403);
  });
});

describe("(b) rate limiting on unauthenticated compute endpoints", () => {
  it("caps the crypto-verification endpoints at 10 per window", async () => {
    const headers = freshIpHeaders({ "content-type": "application/json" });
    const statuses: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      const response = await fetch(`${baseUrl}/api/vps/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ presentation: {} }),
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(statuses[11]).toBe(429);
  });

  it("gives each route its own budget", async () => {
    const headers = freshIpHeaders({ "content-type": "application/json" });

    for (let i = 0; i < 11; i += 1) {
      await fetch(`${baseUrl}/api/vps/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ presentation: {} }),
      });
    }

    // Same IP, different route — must not be collateral damage.
    const resolve = await fetch(
      `${baseUrl}/api/dids/resolve?did=did:midnight:preprod:contract:agent`,
      { headers },
    );
    expect(resolve.status).not.toBe(429);
  });

  it("never rate limits /health", async () => {
    const headers = freshIpHeaders();
    const statuses: number[] = [];

    for (let i = 0; i < 40; i += 1) {
      statuses.push((await fetch(`${baseUrl}/health`, { headers })).status);
    }

    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe("(d) agent MCP key from the header only", () => {
  it("uses the X-MCP-Key header", async () => {
    await fetch(`${baseUrl}/api/agent/did-requests`, {
      method: "POST",
      headers: freshIpHeaders({
        "content-type": "application/json",
        "x-mcp-key": "mcp_from_header",
      }),
      body: JSON.stringify({ agentId: "agent-1" }),
    });

    expect(mockCreateDidRequest).toHaveBeenCalledOnce();
    expect(mockCreateDidRequest.mock.calls[0][0].mcpKey).toBe("mcp_from_header");
  });

  it("ignores a key smuggled in the request body", async () => {
    await fetch(`${baseUrl}/api/agent/did-requests`, {
      method: "POST",
      headers: freshIpHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ agentId: "agent-1", mcpKey: "mcp_from_body" }),
    });

    expect(mockCreateDidRequest).toHaveBeenCalledOnce();
    expect(mockCreateDidRequest.mock.calls[0][0].mcpKey).toBe("");
  });

  it("does not let the body override the header", async () => {
    await fetch(`${baseUrl}/api/agent/did-requests`, {
      method: "POST",
      headers: freshIpHeaders({
        "content-type": "application/json",
        "x-mcp-key": "mcp_from_header",
      }),
      body: JSON.stringify({ agentId: "agent-1", mcpKey: "mcp_from_body" }),
    });

    expect(mockCreateDidRequest.mock.calls[0][0].mcpKey).toBe("mcp_from_header");
  });
});
