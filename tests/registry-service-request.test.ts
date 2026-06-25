import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock("../server/db.js", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("../server/vc-service.js", () => ({
  issueAtomicCredentials: vi.fn(),
}));

describe("registry-service request creation", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("generates an agent id automatically for wallet DID requests", async () => {
    const insertedRequest = {
      id: "request-1",
      customer_id: "customer-1",
      contract_address: "contract-1",
      network_id: "preprod",
      subject_wallet_address: "mn_addr_preprod1example",
      requester_wallet_address: "mn_addr_preprod1example",
      request_status: "pending_admin_review",
    };

    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from customer_wallets cw")) {
          return { rows: [] };
        }
        if (sql.includes("insert into customers")) {
          return { rows: [{ id: "customer-1", email: "user@wallet.local" }] };
        }
        if (sql.includes("insert into customer_wallets")) {
          return { rows: [{ id: "wallet-link-1" }] };
        }
        if (sql.includes("from did_requests") && sql.includes("pending_admin_review")) {
          return { rows: [] };
        }
        if (sql.includes("insert into did_requests")) {
          expect(params[5]).toMatch(/^agent-[0-9a-f-]{36}$/);
          return {
            rows: [
              {
                ...insertedRequest,
                agent_id: params[5],
              },
            ],
          };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        if (sql.includes("update did_requests") && sql.includes("human_approved_at = now()")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));

    const { createWalletDidRequest } = await import("../server/registry-service.js");

    const row = await createWalletDidRequest({
      walletAddress: "mn_addr_preprod1example",
      subjectWalletAddress: "mn_addr_preprod1example",
      contractAddress: "contract-1",
      networkId: "preprod",
      organizationDisclosure: "undisclosed",
      requestPayload: {
        agentName: "Agent Academy",
      },
    });

    expect(row.agent_id).toMatch(/^agent-[0-9a-f-]{36}$/);
    expect(row.request_status).toBe("pending_admin_review");
  });

  it("derives MCP DID request wallet routing from the authenticated customer wallet", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("from mcp_keys mk")) {
        return {
          rows: [
            {
              id: "mcp-key-1",
              customer_id: "customer-1",
              contract_address: "contract-from-key",
              network_id: "preview",
              scopes: ["did.request"],
            },
          ],
        };
      }
      if (sql.includes("update mcp_keys set last_used_at")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected top-level query in test: ${sql}`);
    });

    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from subscriptions")) {
          return {
            rows: [
              {
                id: "subscription-1",
                customer_id: "customer-1",
                did_quota_remaining: 1,
              },
            ],
          };
        }
        if (sql.includes("from customer_wallets") && sql.includes("approved_at is not null")) {
          expect(params[0]).toBe("customer-1");
          return {
            rows: [
              {
                wallet_address: "mn_addr_preprod1primary",
              },
            ],
          };
        }
        if (sql.includes("insert into did_requests")) {
          expect(params[3]).toBe("contract-from-key");
          expect(params[4]).toBe("preview");
          expect(params[6]).toBe("mn_addr_preprod1primary");
          expect(params[7]).toBe("mn_addr_preprod1primary");
          expect(JSON.parse(String(params[11]))).toEqual({
            agentName: "Agent Academy",
            description: "Customer support agent",
            proposedServices: [
              {
                type: "AgentEndpoint",
                serviceEndpoint: "https://agent.example.com",
              },
            ],
          });
          return {
            rows: [
              {
                id: "request-1",
                customer_id: "customer-1",
                subscription_id: "subscription-1",
                mcp_key_id: "mcp-key-1",
                contract_address: params[3],
                network_id: params[4],
                agent_id: params[5],
                requester_wallet_address: params[6],
                subject_wallet_address: params[7],
                request_status: params[8],
              },
            ],
          };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));

    const { createDidRequest } = await import("../server/registry-service.js");

    const row = await createDidRequest({
      mcpKey: "mcp_valid",
      contractAddress: "forged-contract",
      networkId: "forged-network",
      requesterWalletAddress: "mn_addr_preprod1forged_requester",
      subjectWalletAddress: "mn_addr_preprod1forged_subject",
      organizationDisclosure: "undisclosed",
      requestPayload: {
        agentName: "  Agent Academy  ",
        description: "  Customer support agent  ",
        proposedServices: [
          {
            type: "  AgentEndpoint  ",
            serviceEndpoint: "  https://agent.example.com  ",
          },
        ],
      },
    });

    expect(row.request_status).toBe("pending_human_approval");
    expect(row.requester_wallet_address).toBe("mn_addr_preprod1primary");
    expect(row.subject_wallet_address).toBe("mn_addr_preprod1primary");

    await expect(
      createDidRequest({
        mcpKey: "mcp_valid",
        organizationDisclosure: "undisclosed",
        requestPayload: {
          agentName: "Agent Academy",
          didDocument: {
            controller: "mn_addr_preprod1forged",
          },
        },
      }),
    ).rejects.toThrow("requestPayload.didDocument is not supported");
  });
});
