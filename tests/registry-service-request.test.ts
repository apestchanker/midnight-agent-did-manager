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

  it("persists an explicit controller value distinct from the requester wallet", async () => {
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
          expect(sql).toContain("controller");
          expect(params[params.length - 1]).toBe("mn_addr_preprod1controller_explicit");
          return {
            rows: [
              {
                id: "request-2",
                customer_id: "customer-1",
                contract_address: "contract-1",
                network_id: "preprod",
                subject_wallet_address: "mn_addr_preprod1example",
                requester_wallet_address: "mn_addr_preprod1example",
                controller: params[params.length - 1],
                request_status: "pending_admin_review",
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
      controller: "mn_addr_preprod1controller_explicit",
      contractAddress: "contract-1",
      networkId: "preprod",
      organizationDisclosure: "undisclosed",
      requestPayload: {
        agentName: "Agent Academy",
      },
    });

    expect(row.controller).toBe("mn_addr_preprod1controller_explicit");
  });

  it("defaults controller to the requester wallet when omitted", async () => {
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
          expect(sql).toContain("controller");
          expect(params[params.length - 1]).toBe("mn_addr_preprod1example");
          return {
            rows: [
              {
                id: "request-3",
                customer_id: "customer-1",
                contract_address: "contract-1",
                network_id: "preprod",
                subject_wallet_address: "mn_addr_preprod1example",
                requester_wallet_address: "mn_addr_preprod1example",
                controller: params[params.length - 1],
                request_status: "pending_admin_review",
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

    expect(row.controller).toBe("mn_addr_preprod1example");
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
          expect(params[params.length - 1]).toBe("mn_addr_preprod1primary");
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
                controller: params[params.length - 1],
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
      controller: "mn_addr_preprod1forged_controller",
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
    expect(row.controller).toBe("mn_addr_preprod1primary");

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

describe("registry-service approveDidRequestByHuman / rejectDidRequestByHuman — ownership checks", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  const pendingRequest = {
    id: "request-human-1",
    subject_wallet_address: "mn_addr_preprod1subject",
    requester_wallet_address: "mn_addr_preprod1subject",
    request_status: "pending_human_approval",
  };

  function clientDispatch(overrides: Record<string, (params: unknown[]) => unknown> = {}) {
    return {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("select") && sql.includes("from did_requests") && sql.includes("where id = $1") && !sql.includes("update")) {
          return { rows: [pendingRequest] };
        }
        if (sql.includes("update did_requests") && sql.includes("request_status = 'pending_admin_review'")) {
          return overrides.approveUpdate
            ? { rows: [overrides.approveUpdate(params)] }
            : {
                rows: [
                  { ...pendingRequest, request_status: "pending_admin_review", human_approved_by_wallet: params[1] },
                ],
              };
        }
        if (sql.includes("update did_requests") && sql.includes("request_status = 'human_rejected'")) {
          return overrides.rejectUpdate
            ? { rows: [overrides.rejectUpdate(params)] }
            : {
                rows: [
                  { ...pendingRequest, request_status: "human_rejected", human_approved_by_wallet: params[1] },
                ],
              };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };
  }

  it("approveDidRequestByHuman succeeds when the acting wallet matches the request's subject wallet", async () => {
    const client = clientDispatch();
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { approveDidRequestByHuman } = await import("../server/registry-service.js");
    const row = await approveDidRequestByHuman({
      requestId: pendingRequest.id,
      humanWalletAddress: pendingRequest.subject_wallet_address,
    });

    expect(row.request_status).toBe("pending_admin_review");
  });

  it("approveDidRequestByHuman throws when the acting wallet does not match the request's subject wallet", async () => {
    const client = clientDispatch();
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { approveDidRequestByHuman } = await import("../server/registry-service.js");
    await expect(
      approveDidRequestByHuman({
        requestId: pendingRequest.id,
        humanWalletAddress: "mn_addr_preprod1attacker",
      }),
    ).rejects.toThrow("Connected wallet does not match the DID request's subject wallet.");
  });

  it("rejectDidRequestByHuman succeeds when the acting wallet matches the request's subject wallet", async () => {
    const client = clientDispatch();
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { rejectDidRequestByHuman } = await import("../server/registry-service.js");
    const row = await rejectDidRequestByHuman({
      requestId: pendingRequest.id,
      humanWalletAddress: pendingRequest.subject_wallet_address,
      reason: "No longer needed",
    });

    expect(row.request_status).toBe("human_rejected");
  });

  it("rejectDidRequestByHuman throws when the acting wallet does not match the request's subject wallet", async () => {
    const client = clientDispatch();
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { rejectDidRequestByHuman } = await import("../server/registry-service.js");
    await expect(
      rejectDidRequestByHuman({
        requestId: pendingRequest.id,
        humanWalletAddress: "mn_addr_preprod1attacker",
        reason: "Trying to reject someone else's request",
      }),
    ).rejects.toThrow("Connected wallet does not match the DID request's subject wallet.");
  });
});

describe("registry-service issueApprovedDidRequest / rejectDidRequestByAdmin — defensive acting-wallet checks", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("issueApprovedDidRequest throws when called with an empty/undefined acting wallet, before touching the DB", async () => {
    const { issueApprovedDidRequest } = await import("../server/registry-service.js");

    await expect(
      issueApprovedDidRequest({ requestId: "request-1", issuerWalletAddress: "" }),
    ).rejects.toThrow("An issuer wallet address is required to issue a DID request.");
    await expect(
      issueApprovedDidRequest({ requestId: "request-1", issuerWalletAddress: undefined }),
    ).rejects.toThrow("An issuer wallet address is required to issue a DID request.");

    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("rejectDidRequestByAdmin throws when called with an empty/undefined acting wallet, before touching the DB", async () => {
    const { rejectDidRequestByAdmin } = await import("../server/registry-service.js");

    await expect(
      rejectDidRequestByAdmin({ requestId: "request-1", adminWalletAddress: "" }),
    ).rejects.toThrow("An admin wallet address is required to reject a DID request.");
    await expect(
      rejectDidRequestByAdmin({ requestId: "request-1", adminWalletAddress: undefined }),
    ).rejects.toThrow("An admin wallet address is required to reject a DID request.");

    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});

describe("registry-service createOrUpdateDidRequestRecord re-send coalesce", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("does not downgrade an existing did_requests.controller to the requester wallet when re-sending without one", async () => {
    const existing = {
      id: "request-1",
      customer_id: "customer-1",
      contract_address: "contract-1",
      network_id: "preprod",
      agent_id: "agent-1",
      requester_wallet_address: "mn_addr_preprod1requester",
      subject_wallet_address: "mn_addr_preprod1requester",
      request_status: "pending_admin_review",
      controller: "mn_addr_preprod1existing_controller",
      human_approved_at: "2026-07-01T00:00:00Z",
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
        if (
          sql.includes("from did_requests") &&
          sql.includes("pending_human_approval', 'pending_admin_review'")
        ) {
          return { rows: [existing] };
        }
        if (sql.includes("update did_requests") && sql.includes("requester_wallet_address = $2")) {
          expect(sql).toMatch(/controller\s*=\s*coalesce\(\$\d+,\s*controller\)/);
          // controller was omitted from the re-send call, so its bound param
          // must be null/undefined — never a value that would silently reset
          // the field to the requester's own wallet.
          expect(params[params.length - 1] == null).toBe(true);
          return {
            rows: [
              {
                ...existing,
                // Simulates Postgres' coalesce(...) preserving the pre-existing value.
                controller: existing.controller,
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

    const { createWalletDidRequest } = await import("../server/registry-service.js");

    const row = await createWalletDidRequest({
      walletAddress: "mn_addr_preprod1requester",
      subjectWalletAddress: "mn_addr_preprod1requester",
      contractAddress: "contract-1",
      agentId: "agent-1",
      networkId: "preprod",
      organizationDisclosure: "undisclosed",
      requestPayload: { agentName: "Agent Academy" },
      // controller intentionally omitted — re-sending must not reset a prior value.
    });

    expect(row.controller).toBe("mn_addr_preprod1existing_controller");
  });
});
