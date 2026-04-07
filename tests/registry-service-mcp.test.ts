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

describe("registry-service MCP key scopes", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("updates scopes for an existing MCP key", async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("update mcp_keys")) {
          expect(params[0]).toBe("key-row-1");
          expect(params[1]).toBe("customer-1");
          expect(JSON.parse(String(params[2]))).toEqual([
            "did.request",
            "did.credentials",
          ]);
          return {
            rows: [
              {
                id: "key-row-1",
                customer_id: "customer-1",
                label: "agent-key",
                key_id: "key-1",
                status: "active",
                scopes: ["did.request", "did.credentials"],
                created_at: "2026-04-07T00:00:00.000Z",
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

    const { updateCustomerMcpKeyScopes } = await import("../server/registry-service.js");
    const row = await updateCustomerMcpKeyScopes({
      customerId: "customer-1",
      keyId: "key-row-1",
      scopes: ["did.request", "did.credentials", "did.credentials", "ignored.scope"],
    });

    expect(row.scopes).toEqual(["did.request", "did.credentials"]);
  });
});
