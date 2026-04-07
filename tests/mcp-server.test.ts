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
    listCredentialsForDid: vi.fn(async () => []),
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
});
