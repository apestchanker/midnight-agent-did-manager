import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import {
  createMcpServer,
  getHttpStatusForResponse,
  isModernRequest,
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_SERVER_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from "../server/mcp-core.js";
import { readFileSync } from "node:fs";

const MODERN_VERSION = "2026-07-28";
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** Build a spec-shaped modern request plus the headers HTTP requires for it. */
function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  overrides: { version?: string; meta?: Record<string, unknown> } = {},
) {
  const version = overrides.version ?? MODERN_VERSION;
  const meta: Record<string, unknown> = {
    [META_VERSION]: version,
    [META_CAPS]: {},
    "io.modelcontextprotocol/clientInfo": { name: "probe", version: "1.0.0" },
    ...(overrides.meta ?? {}),
  };

  const headers: Record<string, string> = {
    "mcp-protocol-version": version,
    "mcp-method": method,
  };
  const name = (params.name ?? params.uri) as string | undefined;
  if (["tools/call", "resources/read", "prompts/get"].includes(method) && name) {
    headers["mcp-name"] = name;
  }

  return {
    request: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } },
    headers,
  };
}

// Task 8: server/mcp-http.js's GET /logs is now gated by requireSession
// (duplicated from server/index.js per ADR-005) instead of the old
// requireApiAuth/DID_API_AUTH_TOKEN check. These mocks only affect the
// "server/mcp-http.js GET /logs" describe block below — the rest of this
// file exercises server/mcp-core.js's createMcpServer directly with its own
// hand-rolled deps and never touches these real modules.
vi.mock("../server/load-env.js", () => ({}));
vi.mock("../server/log-store.js", () => ({
  getRecentLogs: vi.fn(() => [{ level: "info", message: "hello" }]),
  installProcessLogger: vi.fn(),
}));
vi.mock("../server/db.js", () => ({
  query: vi.fn(async () => ({ rows: [] })),
  withTransaction: vi.fn(),
  initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("../server/registry-service.js", () => ({
  authenticateMcpKey: vi.fn(),
  createDidRequest: vi.fn(),
  getCustomerContextById: vi.fn(),
  getDidRequestById: vi.fn(),
  listDidRequests: vi.fn(),
  resolveDid: vi.fn(),
  validateDid: vi.fn(),
}));
vi.mock("../server/proof-request-service.js", () => ({
  createProofRequestForAgent: vi.fn(),
  getProofRequestById: vi.fn(),
  listProofRequests: vi.fn(),
}));
vi.mock("../server/vc-service.js", () => ({
  getCredentialBundle: vi.fn(),
  getIssuerDescriptor: vi.fn(),
  getMidnightProofMaterial: vi.fn(),
  listCredentialsForDid: vi.fn(),
  rotateCredentialsForDid: vi.fn(),
}));
vi.mock("../server/midnight-proof-service.js", () => ({
  createMidnightProofRequest: vi.fn(),
  verifyMidnightProofSubmission: vi.fn(),
  verifyUnifiedVP: vi.fn(),
}));

const mockValidateSession = vi.fn();
vi.mock("../server/session-service.js", () => ({
  validateSession: mockValidateSession,
}));

function createDeps() {
  return {
    authenticateMcpKey: vi.fn(async (key: string) => {
      if (key !== "mcp_valid") return null;
      return {
        id: "key-1",
        customer_id: "customer-1",
        label: "agent-key",
        scopes: ["did.request", "did.status", "did.resolve", "did.validate"],
      };
    }),
    createDidRequest: vi.fn(async (input: Record<string, unknown>) => ({
      id: "request-1",
      customer_id: "customer-1",
      request_status: "pending_human_approval",
      ...input,
    })),
    getCustomerContextById: vi.fn(async () => ({
      customer: {
        id: "customer-1",
        email: "customer@example.com",
      },
      subscriptions: [],
      mcpKeys: [],
    })),
    getDidRequestById: vi.fn(async (requestId: string) => ({
      id: requestId,
      customer_id: "customer-1",
      request_status: "pending_human_approval",
    })),
    listDidRequests: vi.fn(async () => [
      {
        id: "request-1",
        customer_id: "customer-1",
        request_status: "pending_human_approval",
      },
    ]),
    resolveDid: vi.fn(async (did: string) => ({
      did,
      didDocument: { id: did },
      registry: { status: "active" },
    })),
    validateDid: vi.fn(async (did: string) => ({
      did,
      valid: true,
      status: "active",
    })),
    getIssuerDescriptor: vi.fn(async () => ({
      id: "did:web:issuer.example",
      algorithm: "EdDSA",
    })),
    getCredentialBundle: vi.fn(async ({ did, scopes }: { did: string; scopes?: string[] }) => ({
      holder: did,
      disclosedScopes: scopes || [],
      verifiableCredentials: [],
      presentation: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: did,
        verifiableCredential: [],
      },
    })),
    getMidnightProofMaterial: vi.fn(async ({ did, scopes }: { did: string; scopes?: string[] }) => ({
      did,
      holder: did,
      network: "midnight",
      proofType: "midnight-credential-commitment",
      challenge: "challenge-1",
      purpose: "selective-disclosure",
      disclosedScopes: scopes || [],
      credentialCount: 0,
      credentialCommitments: [],
      bundleCommitment: "a".repeat(64),
      holderBindingCommitment: "b".repeat(64),
      verificationHints: {
        statusCheck: "resolve-did-and-check-active",
        issuerCheck: "verify-vc-jwt-signatures",
        holderBinding: "holder-binding-midnight-proof-required",
      },
    })),
    createMidnightProofRequest: vi.fn(async ({ did, scopes }: { did: string; scopes?: string[] }) => ({
      requestId: "mpr_1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      proofRequestType: "midnight-holder-proof-request",
      material: {
        did,
        holder: did,
        network: "midnight",
        proofType: "midnight-credential-commitment",
        challenge: "challenge-1",
        purpose: "selective-disclosure",
        disclosedScopes: scopes || [],
        credentialCount: 0,
        credentialCommitments: [],
        bundleCommitment: "a".repeat(64),
        holderBindingCommitment: "b".repeat(64),
        verificationHints: {
          statusCheck: "resolve-did-and-check-active",
          issuerCheck: "verify-vc-jwt-signatures",
          holderBinding: "holder-binding-midnight-proof-required",
        },
      },
      instructions: ["Generate proof locally."],
    })),
    listCredentialsForDid: vi.fn(async () => []),
    rotateCredentialsForDid: vi.fn(async ({ did }: { did: string }) => ({
      did,
      revokedCount: 2,
      issuedCount: 2,
      credentials: [],
    })),
    verifyMidnightProofSubmission: vi.fn(async () => ({
      valid: true,
      status: "boundary_verified_only",
      did: "did:midnight:preprod:contract:agent",
      didActive: true,
      issuerCredentialsVerified: true,
      requestIntegrityVerified: true,
      cryptographicProofVerified: false,
      warnings: [],
    })),
    verifyUnifiedVP: vi.fn(async () => ({
      valid: true,
      status: "native_proof_verified",
      did: "did:midnight:preprod:contract:agent",
      didActive: true,
      issuerCredentialsVerified: true,
      requestIntegrityVerified: true,
      cryptographicProofVerified: true,
      submissionMatchesRequest: true,
    })),
  };
}

describe("MCP server core", () => {
  it("initializes and reports discovery capabilities", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      },
      { transport: "stdio", session: {} },
    );

    expect(response?.result.protocolVersion).toBe("2025-11-25");
    expect(response?.result.capabilities.tools).toBeTruthy();
    expect(response?.result.capabilities.resources).toBeTruthy();
    expect(response?.result.capabilities.prompts).toBeTruthy();
  });

  it("echoes back a supported protocol version requested by the client", async () => {
    const server = createMcpServer(createDeps());

    for (const requested of [
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
    ]) {
      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: requested },
        },
        { transport: "stdio", session: {} },
      );

      expect(response?.result.protocolVersion).toBe(requested);
    }
  });

  it("falls back to the newest supported revision for unknown or missing versions", async () => {
    const server = createMcpServer(createDeps());

    // 2026-07-28 is the modern era (per-request _meta + server/discover), which
    // this server does not implement — it must not claim to speak it.
    for (const requested of [undefined, "2026-07-28", "1900-01-01", 42]) {
      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: requested === undefined ? {} : { protocolVersion: requested },
        },
        { transport: "stdio", session: {} },
      );

      expect(response?.result.protocolVersion).toBe("2025-11-25");
    }
  });

  it("advertises its supported revisions in the discovery document", async () => {
    const server = createMcpServer(createDeps());
    const discovery = server.getDiscoveryDocument("https://example.test");

    // The document advertises the newest revision the server speaks overall,
    // with the per-era breakdown alongside it.
    expect(discovery.protocolVersion).toBe("2026-07-28");
    expect(discovery.modernProtocolVersions).toEqual(["2026-07-28"]);
    expect(discovery.legacyProtocolVersions).toEqual([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
    ]);
    expect(discovery.supportedProtocolVersions).toEqual([
      "2026-07-28",
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
    ]);
  });

  it("filters tools by MCP-key scope during discovery", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    const toolNames = response?.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("did_request_create");
    expect(toolNames).toContain("did_request_list");
    expect(toolNames).not.toContain("credential_bundle_get");
  });

  it("creates a DID request through tools/call with authenticated MCP key", async () => {
    const deps = createDeps();
    const server = createMcpServer(deps);
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "did_request_create",
          arguments: {
            organizationDisclosure: "undisclosed",
            requestPayload: {
              agentName: "Agent One",
              description: "Customer support agent",
              proposedServices: [
                {
                  type: "AgentEndpoint",
                  serviceEndpoint: "https://agent.example.com",
                },
              ],
            },
          },
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.createDidRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpKey: "mcp_valid",
        organizationDisclosure: "undisclosed",
      }),
    );
    expect(deps.createDidRequest).toHaveBeenCalledWith(
      expect.not.objectContaining({
        contractAddress: expect.anything(),
        networkId: expect.anything(),
        requesterWalletAddress: expect.anything(),
        subjectWalletAddress: expect.anything(),
      }),
    );
    expect(response?.result.structuredContent.id).toBe("request-1");
  });

  it("publishes the request payload guide in resources/list and resources/read", async () => {
    const server = createMcpServer(createDeps());
    const listResponse = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/list",
      },
      { transport: "http", headers: {} },
    );

    expect(
      listResponse?.result.resources.some(
        (resource: { uri: string }) => resource.uri === "didmn://guide/request-payload",
      ),
    ).toBe(true);

    const readResponse = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "resources/read",
        params: {
          uri: "didmn://guide/request-payload",
        },
      },
      { transport: "http", headers: {} },
    );

    const guide = JSON.parse(readResponse?.result.contents[0].text || "{}");
    expect(guide.requiredFields).not.toContain("agentId");
    expect(guide.requiredFields).not.toContain("contractAddress");
    expect(guide.requiredFields).not.toContain("networkId");
    expect(guide.requiredFields).not.toContain("requesterWalletAddress");
    expect(guide.optionalFields).not.toContain("subjectWalletAddress");
    expect(guide.fieldNotes.agentId).toContain("server will generate");
    expect(guide.fieldNotes.holderWallet).toContain("server derives");
    expect(guide.fieldNotes.registryBinding).toContain("MCP key is bound");
    expect(guide.recommendedRequestPayload).toEqual({
      agentName: "Agent Smith",
      description: "Customer support agent",
      proposedServices: [
        {
          type: "AgentEndpoint",
          serviceEndpoint: "https://agent.example.com",
        },
      ],
    });
    expect(guide.platformGeneratedDidFields).toContain("controller");
    expect(guide.requestPayloadLimits.rationale).toContain(
      "not a W3C DID or Midnight protocol limit",
    );
  });

  it("includes agentId guidance in the request workflow prompt", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "prompts/get",
        params: {
          name: "request_did_workflow",
          arguments: {},
        },
      },
      { transport: "http", headers: {} },
    );

    expect(response?.result.messages[0].content.text).toContain("The server will generate the unique agentId automatically");
    expect(response?.result.messages[0].content.text).toContain("Do not supply registry, network, or wallet routing fields");
    expect(response?.result.messages[0].content.text).toContain(
      "Do not send id, controller, service IDs, a didDocument, or arbitrary metadata",
    );
    expect(response?.result.messages[0].content.text).toContain(
      "didmn://guide/request-payload",
    );
  });

  it("rejects customer-scoped resource reads without authentication", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "resources/read",
        params: {
          uri: "didmn://customer/context",
        },
      },
      {
        transport: "http",
        headers: {},
      },
    );

    expect(response?.error.message).toContain("MCP key required");
  });

  it("reads authenticated customer context resources", async () => {
    const deps = createDeps();
    const server = createMcpServer(deps);
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "resources/read",
        params: {
          uri: "didmn://customer/context",
        },
      },
      {
        transport: "http",
        headers: {
          authorization: "Bearer mcp_valid",
        },
      },
    );

    expect(deps.getCustomerContextById).toHaveBeenCalledWith("customer-1");
    expect(response?.result.contents[0].text).toContain("customer@example.com");
  });

  it("exposes the Midnight proof guide resource", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "resources/read",
        params: {
          uri: "didmn://guide/midnight-proofs",
        },
      },
      { transport: "http", headers: {} },
    );

    expect(response?.result.contents[0].text).toContain("credential_midnight_proof_get");
  });

  it("builds Midnight proof material through tools/call when the key has credential scope", async () => {
    const deps = createDeps();
    deps.authenticateMcpKey = vi.fn(async (key: string) => {
      if (key !== "mcp_valid") return null;
      return {
        id: "key-1",
        customer_id: "customer-1",
        label: "agent-key",
        scopes: ["did.credentials"],
      };
    });
    const server = createMcpServer(deps);
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "credential_midnight_proof_get",
          arguments: {
            did: "did:midnight:preprod:contract:agent",
            scopes: ["ownership"],
          },
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.getMidnightProofMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        did: "did:midnight:preprod:contract:agent",
        scopes: ["ownership"],
        customerId: "customer-1",
      }),
    );
    expect(response?.result.structuredContent.proofType).toBe(
      "midnight-credential-commitment",
    );
  });

  it("creates and verifies Midnight proof requests through MCP tools", async () => {
    const deps = createDeps();
    deps.authenticateMcpKey = vi.fn(async (key: string) => {
      if (key !== "mcp_valid") return null;
      return {
        id: "key-1",
        customer_id: "customer-1",
        label: "agent-key",
        scopes: ["did.credentials"],
      };
    });
    const server = createMcpServer(deps);
    const createResponse = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "credential_midnight_proof_request_create",
          arguments: {
            did: "did:midnight:preprod:contract:agent",
            scopes: ["ownership"],
          },
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.createMidnightProofRequest).toHaveBeenCalled();
    expect(createResponse?.result.structuredContent.proofRequestType).toBe(
      "midnight-holder-proof-request",
    );

    const validVP = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiablePresentation"],
      holder: "did:midnight:preprod:contract:agent",
      verifiableCredential: ["eyJ.jwt1"],
      proof: {
        type: "MidnightNativeOwnershipProof2024",
        created: new Date().toISOString(),
        verificationMethod: "midnight:wallet:did:midnight:preprod:contract:agent",
        proofPurpose: "authentication",
        scheme: "midnight-native-ownership-v1",
        proofValue: "0xdeadbeef",
        publicInputsHash: "0xabc123",
        coinPublicKey: "mn1qtest",
        challenge: "challenge-1",
        bundleCommitment: "a".repeat(64),
        holderBindingCommitment: "b".repeat(64),
        disclosedScopes: ["ownership"],
      },
    };

    const verifyResponse = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: {
          name: "credential_midnight_proof_verify",
          arguments: {
            vp: validVP,
          },
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.verifyUnifiedVP).toHaveBeenCalledWith({ vp: validVP });
    expect(verifyResponse?.result.structuredContent.status).toBe(
      "native_proof_verified",
    );
  });

  it("rotates JWT credentials through the credential tool", async () => {
    const deps = createDeps();
    deps.authenticateMcpKey = vi.fn(async (key: string) => {
      if (key !== "mcp_valid") return null;
      return {
        id: "key-1",
        customer_id: "customer-1",
        label: "agent-key",
        scopes: ["did.credentials"],
      };
    });
    const server = createMcpServer(deps);
    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "credential_rotate",
          arguments: {
            did: "did:midnight:preprod:contract:agent",
          },
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.rotateCredentialsForDid).toHaveBeenCalledWith({
      did: "did:midnight:preprod:contract:agent",
      customerId: "customer-1",
    });
    expect(response?.result.structuredContent.issuedCount).toBe(2);
  });

  it("does not accept process.env.MCP_KEY as authentication for HTTP requests", async () => {
    const oldMcpKey = process.env.MCP_KEY;
    process.env.MCP_KEY = "mcp_valid";
    const deps = createDeps();
    const server = createMcpServer(deps);

    try {
      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 16,
          method: "tools/call",
          params: {
            name: "did_request_list",
            arguments: {},
          },
        },
        {
          transport: "http",
          headers: {},
        },
      );

      expect(response?.error.message).toContain("MCP key required");
      expect(deps.authenticateMcpKey).not.toHaveBeenCalled();
    } finally {
      if (oldMcpKey === undefined) {
        delete process.env.MCP_KEY;
      } else {
        process.env.MCP_KEY = oldMcpKey;
      }
    }
  });

  it("requires credential scope and customer filtering for DID credential resources", async () => {
    const deps = createDeps();
    deps.authenticateMcpKey = vi.fn(async (key: string) => {
      if (key !== "mcp_valid") return null;
      return {
        id: "key-1",
        customer_id: "customer-1",
        label: "agent-key",
        scopes: ["did.credentials"],
      };
    });
    deps.listCredentialsForDid = vi.fn(async () => [
      {
        id: "credential-1",
        credential_jwt: "eyJ.secret.jwt",
      },
    ]);
    const server = createMcpServer(deps);

    const unauthenticated = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 17,
        method: "resources/read",
        params: {
          uri: "didmn://dids/did:midnight:preprod:contract:agent/credentials",
        },
      },
      {
        transport: "http",
        headers: {},
      },
    );

    expect(unauthenticated?.error.message).toContain("MCP key required");

    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: 18,
        method: "resources/read",
        params: {
          uri: "didmn://dids/did:midnight:preprod:contract:agent/credentials",
        },
      },
      {
        transport: "http",
        headers: {
          "x-mcp-key": "mcp_valid",
        },
      },
    );

    expect(deps.listCredentialsForDid).toHaveBeenCalledWith(
      "did:midnight:preprod:contract:agent",
      { customerId: "customer-1" },
    );
    expect(response?.result.contents[0].text).toContain("eyJ.secret.jwt");
  });

  // Task 5: credential_midnight_proof_verify schema-version: 2 tests
  describe("credential_midnight_proof_verify (schema-version: 2)", () => {
    function createCredsDeps() {
      const deps = createDeps();
      deps.authenticateMcpKey = vi.fn(async (key: string) => {
        if (key !== "mcp_valid") return null;
        return {
          id: "key-1",
          customer_id: "customer-1",
          label: "agent-key",
          scopes: ["did.credentials"],
        };
      });
      return deps;
    }

    const credHeaders = { transport: "http", headers: { "x-mcp-key": "mcp_valid" } } as const;

    it("accepts { vp } and returns verified: true on success", async () => {
      const deps = createCredsDeps();
      deps.verifyUnifiedVP = vi.fn(async () => ({
        valid: true,
        status: "native_proof_verified",
        did: "did:midnight:test",
        didActive: true,
        issuerCredentialsVerified: true,
        requestIntegrityVerified: true,
        cryptographicProofVerified: true,
        submissionMatchesRequest: true,
      }));
      const server = createMcpServer(deps);

      const vp = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: "did:midnight:test",
        verifiableCredential: [],
        proof: {
          type: "MidnightNativeOwnershipProof2024",
          created: "2026-05-15T00:00:00.000Z",
          verificationMethod: "midnight:wallet:did:midnight:test",
          proofPurpose: "authentication",
          scheme: "midnight-native-ownership-v1",
          proofValue: "0xdeadbeef",
          publicInputsHash: "0xabc",
          coinPublicKey: "mn1q",
          challenge: "c1",
          bundleCommitment: "b1",
          holderBindingCommitment: "h1",
          disclosedScopes: ["ownership"],
        },
      };

      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 100,
          method: "tools/call",
          params: { name: "credential_midnight_proof_verify", arguments: { vp } },
        },
        credHeaders,
      );

      expect(deps.verifyUnifiedVP).toHaveBeenCalledWith({ vp });
      expect(response?.result.structuredContent.verified).toBe(true);
      expect(response?.result.structuredContent.status).toBe("native_proof_verified");
    });

    it("accepts { vp: degradedVP } and returns verified: false with degraded_proof message", async () => {
      const deps = createCredsDeps();
      deps.verifyUnifiedVP = vi.fn(async () => ({
        valid: false,
        failure_layer: "degraded_proof",
        message: "VP was generated in degraded mode and cannot be cryptographically verified.",
      }));
      const server = createMcpServer(deps);

      const degradedVP = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: "did:midnight:test",
        verifiableCredential: [],
        proof: {
          type: "MidnightNativeOwnershipProof2024",
          created: "2026-05-15T00:00:00.000Z",
          verificationMethod: "midnight:wallet:did:midnight:test",
          proofPurpose: "authentication",
          scheme: "midnight-native-ownership-v1",
          proofValue: "",
          coinPublicKey: "mn1q",
          challenge: "c1",
          bundleCommitment: "b1",
          holderBindingCommitment: "h1",
          disclosedScopes: ["ownership"],
          degraded: true,
        },
      };

      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: { name: "credential_midnight_proof_verify", arguments: { vp: degradedVP } },
        },
        credHeaders,
      );

      expect(deps.verifyUnifiedVP).toHaveBeenCalledWith({ vp: degradedVP });
      expect(response?.result.structuredContent.verified).toBe(false);
      expect(response?.result.structuredContent.failure_layer).toBe("degraded_proof");
    });

    it("accepts { vp: {} } (missing proof fields) and returns structured error with verified: false", async () => {
      const deps = createCredsDeps();
      deps.verifyUnifiedVP = vi.fn(async () => ({
        valid: false,
        failure_layer: "structural",
        message: "VP proof.type must be MidnightNativeOwnershipProof2024",
      }));
      const server = createMcpServer(deps);

      const response = await server.handleRequest(
        {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: { name: "credential_midnight_proof_verify", arguments: { vp: {} } },
        },
        credHeaders,
      );

      expect(deps.verifyUnifiedVP).toHaveBeenCalledWith({ vp: {} });
      expect(response?.result.structuredContent.verified).toBe(false);
      expect(response?.result.structuredContent.failure_layer).toBe("structural");
    });

    it("tool definition has 'vp' as sole required property and no proofRequest/submission", async () => {
      const server = createMcpServer(createDeps());
      const response = await server.handleRequest(
        { jsonrpc: "2.0", id: 103, method: "tools/list" },
        { transport: "http", headers: {} },
      );
      const tool = response?.result.tools.find(
        (t: { name: string }) => t.name === "credential_midnight_proof_verify",
      );
      expect(tool).toBeDefined();
      expect(tool.inputSchema.required).toEqual(["vp"]);
      expect(tool.inputSchema.properties.vp).toBeDefined();
      expect(tool.inputSchema.properties.proofRequest).toBeUndefined();
      expect(tool.inputSchema.properties.submission).toBeUndefined();
      expect(tool.description).toContain("UnifiedVerifiablePresentation");
      expect(tool.description).toContain("MidnightNativeOwnershipProof2024");
    });
  });
});

describe("server/mcp-http.js GET /logs (Task 8: requireSession gating)", () => {
  const ADMIN_TOKEN = "admin-session-token";
  const HUMAN_TOKEN = "human-session-token";
  const ADMIN_WALLET = "mn_addr_preprod1admin";
  const HUMAN_WALLET = "mn_addr_preprod1holder";
  const ORIGINAL_ENV = { ...process.env };

  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
    const mod = await import("../server/mcp-http.js");
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
    mockValidateSession.mockReset();
    mockValidateSession.mockImplementation(async (token: string) => {
      if (token === HUMAN_TOKEN) return { walletAddress: HUMAN_WALLET, isAdmin: false };
      if (token === ADMIN_TOKEN) return { walletAddress: ADMIN_WALLET, isAdmin: true };
      return null;
    });
    process.env.DID_ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
  });

  it("rejects a request with only the legacy DID_API_AUTH_TOKEN and no session (401)", async () => {
    process.env.DID_API_AUTH_TOKEN = "legacy-shared-secret";
    const response = await fetch(`${baseUrl}/logs`, {
      headers: { "x-did-api-key": "legacy-shared-secret" },
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
  });

  // FIX 3 (code review follow-up): a *valid* session token value sent only
  // via X-DID-API-Key (no Authorization header) must not authenticate —
  // before the fix, getApiAuthToken read this header as an alternative to
  // Authorization: Bearer, so this would have succeeded (200).
  it("a valid session token sent only via X-DID-API-Key (no Authorization header) no longer authenticates", async () => {
    const response = await fetch(`${baseUrl}/logs`, {
      headers: { "x-did-api-key": ADMIN_TOKEN },
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
    expect(mockValidateSession).not.toHaveBeenCalledWith(ADMIN_TOKEN);
  });

  it("rejects a valid non-admin session with 403", async () => {
    const response = await fetch(`${baseUrl}/logs`, {
      headers: { authorization: `Bearer ${HUMAN_TOKEN}` },
    });
    expect(response.status).toBe(403);
  });

  it("succeeds for a session whose wallet_address matches DID_ADMIN_WALLET_ADDRESS", async () => {
    const response = await fetch(`${baseUrl}/logs`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("GET /health remains public and unaffected", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("source no longer defines requireApiAuth or compares DID_API_AUTH_TOKEN", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("server/mcp-http.js", "utf-8");
    expect(src).not.toMatch(/function requireApiAuth\s*\(/);
    expect(src).not.toMatch(/process\.env\.DID_API_AUTH_TOKEN/);
    expect(src).toContain("async function requireSession(");
  });
});

describe("MCP dual-era protocol support", () => {
  describe("era detection", () => {
    it("treats a request carrying per-request _meta as modern", () => {
      const { request } = modernRequest("tools/list");
      expect(isModernRequest(request)).toBe(true);
    });

    it("treats initialize and bare requests as legacy", () => {
      expect(
        isModernRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      ).toBe(false);
      expect(
        isModernRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      ).toBe(false);
    });
  });

  describe("server/discover", () => {
    it("reports supported versions, capabilities and identity", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("server/discover");
      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.result.resultType).toBe("complete");
      expect(response?.result.supportedVersions).toEqual(
        MCP_SUPPORTED_PROTOCOL_VERSIONS,
      );
      expect(response?.result.supportedVersions).toContain(MODERN_VERSION);
      expect(response?.result.capabilities.tools).toBeTruthy();
      expect(response?.result._meta[META_SERVER_INFO]).toEqual({
        name: "midnight-did-mcp",
        version: MCP_SERVER_VERSION,
      });
    });
  });

  describe("per-request _meta validation", () => {
    it("rejects a modern request missing clientCapabilities with -32602", async () => {
      const server = createMcpServer(createDeps());
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { [META_VERSION]: MODERN_VERSION } },
      };

      const response = await server.handleRequest(request, {
        transport: "stdio",
        session: {},
      });

      expect(response?.error.code).toBe(-32602);
      expect(getHttpStatusForResponse(response, true)).toBe(400);
    });

    it("rejects an unsupported version with -32022 and lists what it speaks", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/list", {}, {
        version: "1900-01-01",
      });

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32022);
      expect(response?.error.data.requested).toBe("1900-01-01");
      expect(response?.error.data.supported).toEqual(
        MCP_SUPPORTED_PROTOCOL_VERSIONS,
      );
      expect(response?.error.data.modern).toEqual(MCP_MODERN_PROTOCOL_VERSIONS);
      expect(getHttpStatusForResponse(response, true)).toBe(400);
    });

    it("rejects a legacy revision sent in modern framing", async () => {
      const server = createMcpServer(createDeps());
      // 2025-11-25 is real, but it is only reachable through `initialize` —
      // it must not be accepted via per-request _meta.
      const { request, headers } = modernRequest("tools/list", {}, {
        version: "2025-11-25",
      });

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32022);
    });

    it("rejects initialize sent in modern framing with -32601 / 404", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("initialize");

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32601);
      expect(getHttpStatusForResponse(response, true)).toBe(404);
    });
  });

  describe("HTTP header mirroring", () => {
    it("accepts a well-formed modern request and stamps resultType + serverInfo", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/list");

      const response = await server.handleRequest(request, {
        transport: "http",
        headers: { ...headers, "x-mcp-key": "mcp_valid" },
      });

      expect(response?.error).toBeUndefined();
      expect(response?.result.resultType).toBe("complete");
      expect(Array.isArray(response?.result.tools)).toBe(true);
      expect(response?.result._meta[META_SERVER_INFO].version).toBe(
        MCP_SERVER_VERSION,
      );
      expect(getHttpStatusForResponse(response, true)).toBe(200);
    });

    it("rejects a missing MCP-Protocol-Version header with -32020", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/list");
      delete headers["mcp-protocol-version"];

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32020);
      expect(getHttpStatusForResponse(response, true)).toBe(400);
    });

    it("rejects a header/body protocol version disagreement", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/list");
      headers["mcp-protocol-version"] = "2025-11-25";

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32020);
    });

    it("rejects an Mcp-Method header that disagrees with the body", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/list");
      headers["mcp-method"] = "prompts/list";

      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code).toBe(-32020);
    });

    it("requires Mcp-Name on tools/call and matches it against the body", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/call", {
        name: "did_resolve",
        arguments: { did: "did:midnight:preprod:contract:agent" },
      });

      const missing = await server.handleRequest(request, {
        transport: "http",
        headers: (({ "mcp-name": _drop, ...rest }) => rest)(headers),
      });
      expect(missing?.error.code).toBe(-32020);

      const wrong = await server.handleRequest(request, {
        transport: "http",
        headers: { ...headers, "mcp-name": "did_validate" },
      });
      expect(wrong?.error.code).toBe(-32020);
    });

    it("decodes the base64 sentinel form of Mcp-Name before comparing", async () => {
      const server = createMcpServer(createDeps());
      const { request, headers } = modernRequest("tools/call", {
        name: "did_resolve",
        arguments: { did: "did:midnight:preprod:contract:agent" },
      });
      const encoded = `=?base64?${Buffer.from("did_resolve", "utf8").toString("base64")}?=`;

      const response = await server.handleRequest(request, {
        transport: "http",
        headers: { ...headers, "mcp-name": encoded, "x-mcp-key": "mcp_valid" },
      });

      expect(response?.error?.code).not.toBe(-32020);
    });

    it("does not apply header validation to legacy requests", async () => {
      const server = createMcpServer(createDeps());
      // No MCP-Protocol-Version / Mcp-Method headers at all — a legacy client
      // predates them and must keep working.
      const response = await server.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { transport: "http", headers: { "x-mcp-key": "mcp_valid" } },
      );

      expect(response?.error).toBeUndefined();
      expect(Array.isArray(response?.result.tools)).toBe(true);
      // Legacy results must NOT be stamped with modern-only fields.
      expect(response?.result.resultType).toBeUndefined();
    });
  });

  describe("HTTP status mapping", () => {
    it("never maps legacy errors onto non-200 statuses", () => {
      const legacyError = { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } };
      expect(getHttpStatusForResponse(legacyError, false)).toBe(200);
      expect(getHttpStatusForResponse(legacyError, true)).toBe(404);
    });
  });

  describe("reported server version", () => {
    it("matches package.json instead of a hardcoded literal", () => {
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      expect(MCP_SERVER_VERSION).toBe(pkg.version);
      expect(MCP_SERVER_VERSION).not.toBe("0.3.1");
    });

    it("keeps the legacy revision list ordered newest-first", () => {
      expect(MCP_LEGACY_PROTOCOL_VERSIONS[0]).toBe("2025-11-25");
      expect(MCP_LEGACY_PROTOCOL_VERSIONS).toContain("2024-11-05");
    });
  });
});

describe("server/mcp-http.js Streamable HTTP transport (dual-era)", () => {
  let httpServer: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const mod = await import("../server/mcp-http.js");
    httpServer = mod.server;
    if (!httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });
    }
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  async function postMcp(body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  it("answers GET and DELETE on the MCP endpoint with 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${baseUrl}/mcp`, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("returns 400 + UnsupportedProtocolVersionError for a modern unsupported version", async () => {
    const { request, headers } = modernRequest("tools/list", {}, { version: "1900-01-01" });
    const { status, body } = await postMcp(request, headers);

    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toContain("2026-07-28");
  });

  it("returns 400 + HeaderMismatch when the header disagrees with the body", async () => {
    const { request, headers } = modernRequest("tools/list");
    const { status, body } = await postMcp(request, {
      ...headers,
      "mcp-protocol-version": "2025-11-25",
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it("returns 404 + -32601 for an unknown modern method", async () => {
    const { request, headers } = modernRequest("does/not-exist");
    const { status, body } = await postMcp(request, headers);

    expect(status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  it("serves server/discover over HTTP with 200", async () => {
    const { request, headers } = modernRequest("server/discover");
    const { status, body } = await postMcp(request, headers);

    expect(status).toBe(200);
    expect(body.result.resultType).toBe("complete");
    expect(body.result.supportedVersions).toContain("2026-07-28");
  });

  it("still serves the legacy initialize handshake with 200 and no modern headers", async () => {
    const { status, body } = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });

    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("midnight-did-mcp");
  });

  it("keeps legacy JSON-RPC errors on HTTP 200", async () => {
    const { status, body } = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "does/not-exist",
    });

    expect(status).toBe(200);
    expect(body.error.code).toBe(-32601);
  });

  it("acknowledges a notification with 202 and an empty body", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("MCP 2026-07-28 removals and CacheableResult", () => {
  it("rejects methods removed in 2026-07-28 on the modern path", async () => {
    const server = createMcpServer(createDeps());

    for (const method of [
      "ping",
      "logging/setLevel",
      "notifications/roots/list_changed",
      "resources/subscribe",
      "resources/unsubscribe",
    ]) {
      const { request, headers } = modernRequest(method);
      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.error.code, `${method} must be Method not found`).toBe(-32601);
      expect(getHttpStatusForResponse(response, true)).toBe(404);
    }
  });

  it("still answers ping for legacy clients", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { transport: "stdio", session: {} },
    );

    expect(response?.error).toBeUndefined();
    expect(response?.result).toEqual({});
  });

  it("marks scope-filtered listings private so intermediaries cannot re-serve them", async () => {
    const server = createMcpServer(createDeps());

    for (const method of ["tools/list", "resources/list"]) {
      const { request, headers } = modernRequest(method);
      const response = await server.handleRequest(request, {
        transport: "http",
        headers: { ...headers, "x-mcp-key": "mcp_valid" },
      });

      expect(response?.result.cacheScope, `${method} varies by MCP key`).toBe("private");
      expect(typeof response?.result.ttlMs).toBe("number");
    }
  });

  it("marks auth-independent listings public", async () => {
    const server = createMcpServer(createDeps());

    for (const method of ["prompts/list", "resources/templates/list"]) {
      const { request, headers } = modernRequest(method);
      const response = await server.handleRequest(request, {
        transport: "http",
        headers,
      });

      expect(response?.result.cacheScope, method).toBe("public");
      expect(typeof response?.result.ttlMs).toBe("number");
    }
  });

  it("does not leak cache fields onto legacy results", async () => {
    const server = createMcpServer(createDeps());
    const response = await server.handleRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { transport: "http", headers: { "x-mcp-key": "mcp_valid" } },
    );

    expect(response?.result.ttlMs).toBeUndefined();
    expect(response?.result.cacheScope).toBeUndefined();
  });
});

describe("server/mcp-http.js Origin validation (DNS rebinding guard)", () => {
  const ORIGINAL_ENV = { ...process.env };
  let httpServer: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DID_CORS_ALLOWED_ORIGINS = "https://multipass-site.onrender.com";
    const mod = await import("../server/mcp-http.js");
    httpServer = mod.server;
    if (!httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => resolve());
      });
    }
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows requests with no Origin header at all (non-browser clients)", async () => {
    const { request, headers } = modernRequest("server/discover");
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
  });

  it("allows an Origin on the allowlist", async () => {
    const { request, headers } = modernRequest("server/discover");
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://multipass-site.onrender.com",
        ...headers,
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a disallowed Origin with 403 before processing the request", async () => {
    const { request, headers } = modernRequest("server/discover");
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
        ...headers,
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.message).toMatch(/Origin/i);
    // Spec: the error response carries no id.
    expect(body.id).toBeUndefined();
  });

  it("rejects a disallowed Origin on the preflight too", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });

    expect(response.status).toBe(403);
  });

  it("does not block the health check", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});
