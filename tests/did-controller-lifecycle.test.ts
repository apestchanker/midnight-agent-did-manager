import { beforeEach, describe, expect, it, vi } from "vitest";

// Cross-layer lifecycle tests for feature 006-clarify-did-controller-metadata.
//
// This repo has no real-Postgres test harness (see sdd/wip/006-.../meta.md notes) —
// every registry-service.js test mocks server/db.js's `query`/`withTransaction`.
// "Integration" here therefore means exercising multiple exported functions from
// server/registry-service.js together against a single coherent mocked DB, tracing
// controller through request -> issue -> resolve and update -> resolve, rather than
// a live database round-trip.

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

describe("Task 12 — cross-layer controller lifecycle", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
    issueAtomicCredentialsMock.mockReset();
    issueAtomicCredentialsMock.mockResolvedValue(undefined);
  });

  it("REQ-01/REQ-03: a full request-then-issue cycle with controller ('C1') distinct from subject_wallet_address persists C1 into did_records and resolveDid()", async () => {
    const controllerC1 = "mn_addr_preview1controller_c1";
    const subjectWallet = "mn_addr_preview1subject_agent";
    const requesterWallet = "mn_addr_preview1requester_human";
    const issuerWallet = "mn_addr_preview1issuer_human";

    // ── Step 1: createWalletDidRequest — request stage ────────────────────────
    let insertedRequest: Record<string, unknown> | undefined;
    const requestClient = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from customer_wallets cw")) {
          return { rows: [] };
        }
        if (sql.includes("insert into customers")) {
          return { rows: [{ id: "customer-1", email: "requester@wallet.local" }] };
        }
        if (sql.includes("insert into customer_wallets")) {
          return { rows: [{ id: "wallet-link-1" }] };
        }
        if (sql.includes("from did_requests") && sql.includes("pending_admin_review")) {
          return { rows: [] };
        }
        if (sql.includes("insert into did_requests")) {
          insertedRequest = {
            id: "request-lifecycle-1",
            customer_id: "customer-1",
            subscription_id: params[1],
            mcp_key_id: params[2],
            contract_address: params[3],
            network_id: params[4],
            agent_id: params[5],
            requester_wallet_address: params[6],
            subject_wallet_address: params[7],
            request_status: params[8],
            organization_name: params[9],
            organization_disclosure: params[10],
            request_payload: JSON.parse(String(params[11])),
            selective_disclosure_template: JSON.parse(String(params[12])),
            requested_did: params[13],
            onchain_request_tx_id: params[14],
            onchain_request_tx_hash: params[15],
            human_approved_at: params[16],
            human_approved_by_wallet: params[17],
            controller: params[18],
          };
          return { rows: [insertedRequest] };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        if (sql.includes("update did_requests") && sql.includes("human_approved_at = now()")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in request stage: ${sql}`);
      }),
    };
    withTransactionMock.mockImplementation(async (run) => run(requestClient));

    const { createWalletDidRequest, issueApprovedDidRequest, resolveDid } = await import(
      "../server/registry-service.js"
    );

    const requestRow = await createWalletDidRequest({
      walletAddress: requesterWallet,
      agentId: "agent-lifecycle-1",
      subjectWalletAddress: subjectWallet,
      controller: controllerC1,
      contractAddress: "contract-lifecycle-1",
      networkId: "preview",
      organizationDisclosure: "undisclosed",
      requestPayload: { agentName: "Lifecycle Agent" },
    });

    expect(requestRow.controller).toBe(controllerC1);
    expect(requestRow.subject_wallet_address).toBe(subjectWallet);
    expect(requestRow.controller).not.toBe(requestRow.subject_wallet_address);

    // ── Step 2: issueApprovedDidRequest — issuance stage ──────────────────────
    let issuedRecordRow: Record<string, unknown> | undefined;
    const issueClient = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from did_requests") && sql.includes("for update")) {
          return { rows: [insertedRequest] };
        }
        if (sql.includes("from customer_wallets cw")) {
          return { rows: [] };
        }
        if (sql.includes("insert into customers")) {
          return { rows: [{ id: "customer-2", email: "subject@wallet.local" }] };
        }
        if (sql.includes("insert into customer_wallets")) {
          return { rows: [] };
        }
        if (sql.includes("from did_records") && sql.includes("where did = $1")) {
          return { rows: [] };
        }
        if (sql.includes("insert into did_records")) {
          issuedRecordRow = {
            id: "record-lifecycle-1",
            request_id: params[0],
            did: params[1],
            contract_address: params[2],
            network_id: params[3],
            agent_id: params[4],
            subject_wallet_address: params[5],
            subject_agent_key: params[6],
            issuer_wallet_address: params[7],
            status: "active",
            organization_name: params[8],
            organization_disclosure: params[9],
            did_commitment: params[10],
            document_commitment: params[11],
            proof_commitment: params[12],
            did_document: JSON.parse(String(params[13])),
            claims_manifest: JSON.parse(String(params[14])),
            controller: params[15],
          };
          return { rows: [issuedRecordRow] };
        }
        if (sql.includes("update did_requests") && sql.includes("request_status = 'issued'")) {
          return { rows: [{ ...insertedRequest, request_status: "issued" }] };
        }
        if (sql.includes("insert into audit_events")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query in issue stage: ${sql}`);
      }),
    };
    withTransactionMock.mockImplementation(async (run) => run(issueClient));

    const { record } = await issueApprovedDidRequest({
      requestId: requestRow.id,
      issuerWalletAddress: issuerWallet,
    });

    expect(record.controller).toBe(controllerC1);
    expect(record.subject_wallet_address).toBe(subjectWallet);

    // ── Step 3: resolveDid — resolution stage ─────────────────────────────────
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("from did_records") && sql.includes("where did = $1")) {
        expect(params[0]).toBe(issuedRecordRow?.did);
        return { rows: [issuedRecordRow] };
      }
      throw new Error(`Unexpected query in resolve stage: ${sql}`);
    });

    const resolved = await resolveDid(String(issuedRecordRow?.did));

    expect(resolved?.didDocument.controller).toBe(controllerC1);
  });

  it("REQ-03: updating an issued DID's controller from C1 to C2 via syncWalletUpdatedDid is reflected by a subsequent resolveDid(), not the prior C1 value", async () => {
    const did = "did:midnight:preview:contract-lifecycle-2:agent-lifecycle-2";
    const controllerC1 = "mn_addr_preview1controller_c1";
    const controllerC2 = "mn_addr_preview1controller_c2";

    // ── Before the update: resolveDid reflects the existing C1 value ─────────
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("from did_records") && sql.includes("where did = $1")) {
        expect(params[0]).toBe(did);
        return {
          rows: [
            {
              did,
              controller: controllerC1,
              status: "active",
            },
          ],
        };
      }
      throw new Error(`Unexpected query in pre-update resolve: ${sql}`);
    });

    const { resolveDid, syncWalletUpdatedDid } = await import("../server/registry-service.js");

    const beforeUpdate = await resolveDid(did);
    expect(beforeUpdate?.didDocument.controller).toBe(controllerC1);

    // ── The update itself: syncWalletUpdatedDid(controller: C2) ──────────────
    const updateClient = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("update did_records") && sql.includes("did_document = $2")) {
          expect(sql).toMatch(/controller\s*=\s*coalesce\(\$\d+,\s*controller\)/);
          expect(params[params.length - 1]).toBe(controllerC2);
          return {
            rows: [
              {
                did,
                did_document: JSON.parse(String(params[1])),
                controller: controllerC2,
                status: "active",
              },
            ],
          };
        }
        throw new Error(`Unexpected query in update stage: ${sql}`);
      }),
    };
    withTransactionMock.mockImplementation(async (run) => run(updateClient));

    const updated = await syncWalletUpdatedDid({
      did,
      didDocument: { id: did },
      controller: controllerC2,
    });

    expect(updated.controller).toBe(controllerC2);

    // ── After the update: resolveDid reflects C2, not the stale C1 ───────────
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("from did_records") && sql.includes("where did = $1")) {
        expect(params[0]).toBe(did);
        return {
          rows: [
            {
              did,
              controller: controllerC2,
              status: "active",
            },
          ],
        };
      }
      throw new Error(`Unexpected query in post-update resolve: ${sql}`);
    });

    const afterUpdate = await resolveDid(did);
    expect(afterUpdate?.didDocument.controller).toBe(controllerC2);
    expect(afterUpdate?.didDocument.controller).not.toBe(controllerC1);
  });

  it("REQ-04/ADR-002: a legacy did_requests/did_records row pair with controller = null exercises the two independent fallback rules without interfering with each other", async () => {
    const { buildDidDocumentForRequest } = await import("../src/lib/did/request-document.js");
    const { resolveDid } = await import("../server/registry-service.js");

    const legacySubjectWallet = "mn_addr_preview1legacy_subject";
    const legacyRequestedDid = "did:midnight:preview:contract-legacy:agent-legacy";

    // buildDidDocumentForRequest's own fallback rule (issuance-time document builder,
    // used by issueApprovedDidRequest): controller = null -> falls back to
    // subject_wallet_address, per task 4 / ADR-002.
    const legacyRequestRow = {
      requested_did: legacyRequestedDid,
      controller: null,
      subject_wallet_address: legacySubjectWallet,
      request_payload: {},
      organization_disclosure: "undisclosed",
      organization_name: null,
    };

    const legacyDidDocument = buildDidDocumentForRequest(legacyRequestRow);
    expect(legacyDidDocument.controller).toBe(legacySubjectWallet);
    expect(legacyDidDocument.controller).not.toBe(legacyRequestedDid);

    // resolveDid's own, independent fallback rule (resolution endpoint):
    // controller = null -> falls back to the DID's own identifier (record.did),
    // per task 5 / ADR-002 — deliberately NOT the same fallback value as above.
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("from did_records") && sql.includes("where did = $1")) {
        expect(params[0]).toBe(legacyRequestedDid);
        return {
          rows: [
            {
              did: legacyRequestedDid,
              controller: null,
              subject_wallet_address: legacySubjectWallet,
              status: "active",
            },
          ],
        };
      }
      throw new Error(`Unexpected query in legacy resolve: ${sql}`);
    });

    const resolved = await resolveDid(legacyRequestedDid);
    expect(resolved?.didDocument.controller).toBe(legacyRequestedDid);
    expect(resolved?.didDocument.controller).not.toBe(legacySubjectWallet);

    // The two fallback rules land on different values for the exact same legacy
    // scenario, confirming they are independent (ADR-002) rather than unified.
    expect(legacyDidDocument.controller).not.toBe(resolved?.didDocument.controller);
  });
});
