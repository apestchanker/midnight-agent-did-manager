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

  it("binds a new MCP key to the current registry deployment", async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from admin_registry_deployments")) {
          expect(params[0]).toBe("preview");
          return {
            rows: [
              {
                contract_address: "contract-current",
                network_id: "preview",
              },
            ],
          };
        }
        if (sql.includes("insert into mcp_keys")) {
          expect(params[4]).toBe("contract-current");
          expect(params[5]).toBe("preview");
          return {
            rows: [
              {
                id: "key-row-1",
                customer_id: "customer-1",
                label: "agent-key",
                key_id: "key-id",
                contract_address: params[4],
                network_id: params[5],
                status: "active",
                scopes: JSON.parse(String(params[6])),
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

    const { createCustomerMcpKey } = await import("../server/registry-service.js");
    const row = await createCustomerMcpKey({
      customerId: "customer-1",
      label: "agent-key",
      networkId: "preview",
    });

    expect(row.contract_address).toBe("contract-current");
    expect(row.network_id).toBe("preview");
    expect(row.plainTextKey).toMatch(/^mcp_/);
  });
});
