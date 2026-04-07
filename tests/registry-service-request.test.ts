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
});
