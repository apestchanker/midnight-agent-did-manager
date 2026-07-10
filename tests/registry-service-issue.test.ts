import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const issueAtomicCredentialsMock = vi.fn();

vi.mock("../server/db.js", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("../server/vc-service.js", () => ({
  issueAtomicCredentials: issueAtomicCredentialsMock,
}));

describe("registry-service issueApprovedDidRequest", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
    issueAtomicCredentialsMock.mockReset();
  });

  it("returns the existing request and record when the request is already issued", async () => {
    const request = {
      id: "request-1",
      request_status: "issued",
      requested_did: "did:midnight:preprod:contract:agent",
    };
    const record = {
      id: "record-1",
      request_id: "request-1",
      did: request.requested_did,
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [request] })
        .mockResolvedValueOnce({ rows: [record] }),
    };
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { issueApprovedDidRequest } = await import("../server/registry-service.js");

    await expect(
      issueApprovedDidRequest({
        requestId: request.id,
        issuerWalletAddress: "addr_test_issuer",
      }),
    ).resolves.toEqual({
      request,
      record,
    });

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(issueAtomicCredentialsMock).not.toHaveBeenCalled();
  });

  it("passes the request's persisted controller through to the issued did_records row", async () => {
    const request = {
      id: "request-1",
      request_status: "pending_admin_review",
      requested_did: "did:midnight:preview:contract:agent-1",
      subject_wallet_address: "mn_addr_preview1subject",
      agent_id: "agent-1",
      contract_address: "contract-1",
      network_id: "preview",
      organization_name: null,
      organization_disclosure: "undisclosed",
      request_payload: { agentName: "Agent Smith" },
      selective_disclosure_template: null,
      subscription_id: null,
      controller: "mn_addr_preview1controller_from_request",
    };

    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from did_requests") && sql.includes("for update")) {
          return { rows: [request] };
        }
        if (sql.includes("from customer_wallets cw")) {
          return { rows: [] };
        }
        if (sql.includes("insert into customers")) {
          return { rows: [{ id: "customer-1", email: "user@wallet.local" }] };
        }
        if (sql.includes("insert into customer_wallets")) {
          return { rows: [] };
        }
        if (sql.includes("from did_records") && sql.includes("where did = $1")) {
          return { rows: [] };
        }
        if (sql.includes("insert into did_records")) {
          expect(sql).toContain("controller");
          expect(params[params.length - 1]).toBe("mn_addr_preview1controller_from_request");
          return {
            rows: [
              {
                id: "record-1",
                did: request.requested_did,
                controller: params[params.length - 1],
              },
            ],
          };
        }
        if (sql.includes("update did_requests") && sql.includes("request_status = 'issued'")) {
          return { rows: [{ ...request, request_status: "issued" }] };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));
    issueAtomicCredentialsMock.mockResolvedValue(undefined);

    const { issueApprovedDidRequest } = await import("../server/registry-service.js");

    const { record } = await issueApprovedDidRequest({
      requestId: request.id,
      issuerWalletAddress: "addr_test_issuer",
    });

    expect(record.controller).toBe("mn_addr_preview1controller_from_request");
  });
});

describe("registry-service syncWalletUpdatedDid controller coalesce", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("extends the did_records update with controller = coalesce($N, controller) and does not null out the existing value when controller is omitted", async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("update did_records") && sql.includes("did_document = $2")) {
          expect(sql).toMatch(/controller\s*=\s*coalesce\(\$\d+,\s*controller\)/);
          // controller was omitted from the call, so its bound param must be null/undefined —
          // never the string that would clear the column via a hard overwrite.
          expect(params[params.length - 1] == null).toBe(true);
          return {
            rows: [
              {
                did: params[0],
                did_document: JSON.parse(params[1] as string),
                // Simulates Postgres' coalesce(...) preserving the pre-existing value
                // because the bound controller param is null.
                controller: "mn_addr_preview1existing_controller",
              },
            ],
          };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));

    const { syncWalletUpdatedDid } = await import("../server/registry-service.js");

    const record = await syncWalletUpdatedDid({
      did: "did:midnight:preview:contract:agent-1",
      didDocument: { id: "did:midnight:preview:contract:agent-1" },
    });

    expect(record.controller).toBe("mn_addr_preview1existing_controller");
  });

  it("binds the new controller value when the update call supplies one", async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("update did_records") && sql.includes("did_document = $2")) {
          expect(params[params.length - 1]).toBe("mn_addr_preview1new_controller");
          return {
            rows: [
              {
                did: params[0],
                controller: "mn_addr_preview1new_controller",
              },
            ],
          };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));

    const { syncWalletUpdatedDid } = await import("../server/registry-service.js");

    const record = await syncWalletUpdatedDid({
      did: "did:midnight:preview:contract:agent-1",
      didDocument: { id: "did:midnight:preview:contract:agent-1" },
      controller: "mn_addr_preview1new_controller",
    });

    expect(record.controller).toBe("mn_addr_preview1new_controller");
  });
});

describe("registry-service syncWalletIssuedDid re-issue controller coalesce", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("does not null out an existing did_records.controller when re-issuing without one (upsertIssuedDidRecord update branch)", async () => {
    const existingRecord = {
      id: "record-1",
      did: "did:midnight:preview:contract:agent-1",
      controller: "mn_addr_preview1existing_controller",
    };

    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from did_requests") && sql.includes("order by created_at desc")) {
          return { rows: [] };
        }
        if (sql.includes("from customer_wallets cw")) {
          return { rows: [] };
        }
        if (sql.includes("insert into customers")) {
          return { rows: [{ id: "customer-1", email: "user@wallet.local" }] };
        }
        if (sql.includes("insert into customer_wallets")) {
          return { rows: [] };
        }
        if (sql.includes("from did_records") && sql.includes("where did = $1")) {
          return { rows: [existingRecord] };
        }
        if (sql.includes("update did_records") && sql.includes("issuer_wallet_address = $2")) {
          expect(sql).toMatch(/controller\s*=\s*coalesce\(\$\d+,\s*controller\)/);
          // controller was omitted from the sync call, so its bound param must be
          // null/undefined — never a value that would clear the column via a hard overwrite.
          expect(params[params.length - 1] == null).toBe(true);
          return {
            rows: [
              {
                ...existingRecord,
                // Simulates Postgres' coalesce(...) preserving the pre-existing value.
                controller: existingRecord.controller,
              },
            ],
          };
        }
        throw new Error(`Unexpected query in test: ${sql}`);
      }),
    };

    withTransactionMock.mockImplementation(async (run) => run(client));

    const { syncWalletIssuedDid } = await import("../server/registry-service.js");

    const { record } = await syncWalletIssuedDid({
      did: existingRecord.did,
      issuerWalletAddress: "addr_test_issuer",
      subjectWalletAddress: "mn_addr_preview1subject",
      agentId: "agent-1",
      contractAddress: "contract-1",
      networkId: "preview",
      didDocument: { id: existingRecord.did },
      // controller intentionally omitted — re-issuing must not clear a prior value.
    });

    expect(record.controller).toBe("mn_addr_preview1existing_controller");
  });
});

describe("registry-service resolveDid controller fallback", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  const baseRecord = {
    did: "did:midnight:preview:contract:agent-1",
    organization_disclosure: "undisclosed",
    organization_name: null,
    contract_address: "contract-1",
    network_id: "preview",
    status: "active",
    subject_wallet_address: "mn_addr_preview1subject",
    issuer_wallet_address: "mn_addr_preview1issuer",
    did_commitment: "commit-1",
    document_commitment: "doc-1",
    proof_commitment: "proof-1",
    revocation_commitment: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  it("returns controller = record.controller when present", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          ...baseRecord,
          controller: "mn_addr_preview1explicit_controller",
        },
      ],
    });

    const { resolveDid } = await import("../server/registry-service.js");
    const result = await resolveDid(baseRecord.did);

    expect(result.didDocument.controller).toBe("mn_addr_preview1explicit_controller");
  });

  it("falls back to record.did when record.controller is null/undefined (legacy row)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          ...baseRecord,
          did: "did:midnight:preview:contract:agent-legacy",
          controller: null,
        },
      ],
    });

    const { resolveDid } = await import("../server/registry-service.js");
    const result = await resolveDid("did:midnight:preview:contract:agent-legacy");

    expect(result.didDocument.controller).toBe("did:midnight:preview:contract:agent-legacy");
  });
});

describe("registry-service listRegistryDidRecords controller column", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
  });

  it("includes dr.controller in the explicit column SELECT and passes it through on each row", async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(sql).toContain("dr.controller,");
      expect(params[0]).toBe("contract-1");
      return {
        rows: [
          {
            id: "record-1",
            did: "did:midnight:preview:contract:agent-1",
            controller: "mn_addr_preview1controller",
            did_document: { agentName: "Agent Smith" },
          },
        ],
      };
    });

    const { listRegistryDidRecords } = await import("../server/registry-service.js");
    const rows = await listRegistryDidRecords("contract-1");

    expect(rows[0].controller).toBe("mn_addr_preview1controller");
  });
});
