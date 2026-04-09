import { beforeEach, describe, expect, it, vi } from "vitest";

const withTransactionMock = vi.fn();
vi.mock("../server/db.js", () => ({
  withTransaction: withTransactionMock,
  query: vi.fn(),
}));

vi.mock("../server/issuer-keys.js", () => ({
  getIssuerKeys: vi.fn(),
}));

describe("vc rotation", () => {
  beforeEach(() => {
    withTransactionMock.mockReset();
  });

  it("revokes active credentials and reissues fresh JWT VCs for the DID", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "record-1",
              request_id: "request-1",
              customer_id: "customer-1",
              did: "did:midnight:preprod:contract:agent",
              contract_address: "contract",
              network_id: "preprod",
              subject_wallet_address: "mn_addr_preprod1holder",
              subject_agent_key: "agent-key",
              status: "active",
              organization_name: null,
              organization_disclosure: "undisclosed",
              did_document: {
                agentName: "Agent Academy",
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [{ id: "old-1" }, { id: "old-2" }],
        }),
    };
    withTransactionMock.mockImplementation(async (run) => run(client));

    const { rotateCredentialsForDid } = await import("../server/vc-service.js");
    const issueAtomicCredentialsMock = vi.fn().mockResolvedValue([
      { id: "new-1" },
      { id: "new-2" },
    ]);

    const result = await rotateCredentialsForDid(
      {
        did: "did:midnight:preprod:contract:agent",
      },
      {
        issueAtomicCredentials: issueAtomicCredentialsMock,
      },
    );

    expect(result.revokedCount).toBe(2);
    expect(result.issuedCount).toBe(2);
    expect(issueAtomicCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        didRecordId: "record-1",
        subjectDid: "did:midnight:preprod:contract:agent",
        profileName: "Agent Academy",
      }),
    );
  });
});
