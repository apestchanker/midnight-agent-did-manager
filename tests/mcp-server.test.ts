import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../server/mcp-core.js";

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

    expect(response?.result.protocolVersion).toBe("2024-11-05");
    expect(response?.result.capabilities.tools).toBeTruthy();
    expect(response?.result.capabilities.resources).toBeTruthy();
    expect(response?.result.capabilities.prompts).toBeTruthy();
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
            contractAddress: "contract-1",
            networkId: "preprod",
            requesterWalletAddress: "wallet-1",
            organizationDisclosure: "undisclosed",
            requestPayload: {
              agentName: "Agent One",
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
        contractAddress: "contract-1",
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
    expect(guide.fieldNotes.agentId).toContain("server will generate");
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
          arguments: {
            contractAddress: "contract-1",
            networkId: "preprod",
          },
        },
      },
      { transport: "http", headers: {} },
    );

    expect(response?.result.messages[0].content.text).toContain("The server will generate the unique agentId automatically");
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
