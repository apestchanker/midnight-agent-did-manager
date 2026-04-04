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
});
