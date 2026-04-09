import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const authenticateMcpKeyMock = vi.fn();
const getCustomerByWalletMock = vi.fn();
const createMidnightProofRequestMock = vi.fn();
const verifyMidnightProofSubmissionMock = vi.fn();

vi.mock("../server/db.js", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("../server/registry-service.js", () => ({
  authenticateMcpKey: authenticateMcpKeyMock,
  getCustomerByWallet: getCustomerByWalletMock,
}));

vi.mock("../server/midnight-proof-service.js", () => ({
  createMidnightProofRequest: createMidnightProofRequestMock,
  verifyMidnightProofSubmission: verifyMidnightProofSubmissionMock,
}));

describe("proof-request-service", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
    authenticateMcpKeyMock.mockReset();
    getCustomerByWalletMock.mockReset();
    createMidnightProofRequestMock.mockReset();
    verifyMidnightProofSubmissionMock.mockReset();
  });

  it("creates an agent proof request with approval payload", async () => {
    authenticateMcpKeyMock.mockResolvedValue({
      id: "mcp-row-1",
      customer_id: "customer-1",
    });
    createMidnightProofRequestMock.mockResolvedValue({
      requestId: "mpr-1",
      material: {
        did: "did:midnight:preprod:contract:agent",
        challenge: "challenge-1",
        purpose: "selective-disclosure",
        verifier: "https://verifier.example",
        disclosedScopes: ["ownership"],
        bundleCommitment: "a".repeat(64),
        holderBindingCommitment: "b".repeat(64),
      },
    });
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "did-record-1",
                did: "did:midnight:preprod:contract:agent",
                contract_address: "contract",
                network_id: "preprod",
                agent_id: "agent-1",
                subject_wallet_address: "mn_addr_preprod1holder",
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-1",
                request_status: "pending_human_approval",
                approval_payload: "{payload}",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { createProofRequestForAgent } = await import(
      "../server/proof-request-service.js"
    );
    const result = await createProofRequestForAgent({
      mcpKey: "mcp_123.secret",
      did: "did:midnight:preprod:contract:agent",
      requesterWalletAddress: "mn_addr_preprod1requester",
      scopes: ["ownership"],
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
    });

    expect(result.id).toBe("proof-request-1");
    expect(createMidnightProofRequestMock).toHaveBeenCalled();
  });

  it("approves a proof request when the connected wallet signature matches", async () => {
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-1",
                did: "did:midnight:preprod:contract:agent",
                holder_wallet_address: "mn_addr_preprod1holder",
                request_status: "pending_human_approval",
                approval_payload: "payload-to-sign",
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-1",
                request_status: "proof_ready",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { approveProofRequestByHuman } = await import(
      "../server/proof-request-service.js"
    );
    const result = await approveProofRequestByHuman(
      {
        proofRequestId: "proof-request-1",
        humanWalletAddress: "mn_addr_preprod1holder",
        holderSignature: {
          data: "payload-to-sign",
          signature: "sig",
          verifyingKey: "vk",
        },
      },
      {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => "mn_addr_preprod1holder"),
      },
    );

    expect(result.request_status).toBe("proof_ready");
  });

  it("accepts a valid wallet signature when address derivation from verifying key is unavailable", async () => {
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-2",
                did: "did:midnight:preprod:contract:agent",
                holder_wallet_address: "mn_addr_preprod1holder",
                request_status: "pending_human_approval",
                approval_payload: "payload-to-sign",
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-2",
                request_status: "proof_ready",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { approveProofRequestByHuman } = await import(
      "../server/proof-request-service.js"
    );
    const result = await approveProofRequestByHuman(
      {
        proofRequestId: "proof-request-2",
        humanWalletAddress: "mn_addr_preprod1holder",
        holderSignature: {
          data: "payload-to-sign",
          signature: "sig",
          verifyingKey: "mn_addr_preprod1holder",
        },
      },
      {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => {
          throw new Error("Malformed Schnorr verifying key");
        }),
      },
    );

    expect(result.request_status).toBe("proof_ready");
  });

  it("normalizes wallet signature fields when the wallet returns hex-encoded ascii hex", async () => {
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-3",
                did: "did:midnight:preprod:contract:agent",
                network_id: "preprod",
                holder_wallet_address:
                  "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
                request_status: "pending_human_approval",
                approval_payload: "payload-to-sign",
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-3",
                request_status: "proof_ready",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { approveProofRequestByHuman } = await import(
      "../server/proof-request-service.js"
    );
    const verifySignature = vi.fn(() => true);
    const result = await approveProofRequestByHuman(
      {
        proofRequestId: "proof-request-3",
        humanWalletAddress:
          "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
        holderSignature: {
          data: "payload-to-sign",
          signature: Buffer.from("03ed5784f35ab0", "utf8").toString("hex"),
          verifyingKey: Buffer.from(
            "05d021d126ba0a79d47a1649a434e737d9e98d0c1df8968223545bcd587519c2",
            "utf8",
          ).toString("hex"),
        },
      },
      {
        verifySignature,
        addressFromKey: vi.fn(
          () => "9bcd03a50d2a66157e579ae37b483e45dc349341d4963f465601735225d7efb2",
        ),
      },
    );

    expect(verifySignature).toHaveBeenCalledWith(
      "05d021d126ba0a79d47a1649a434e737d9e98d0c1df8968223545bcd587519c2",
      expect.any(Uint8Array),
      "03ed5784f35ab0",
    );
    expect(result.request_status).toBe("proof_ready");
  });

  it("rejects a pending proof request from the holder wallet", async () => {
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-4",
                did: "did:midnight:preprod:contract:agent",
                holder_wallet_address: "mn_addr_preprod1holder",
                request_status: "pending_human_approval",
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-4",
                request_status: "human_rejected",
                error_message: "No longer needed",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { rejectProofRequestByHuman } = await import(
      "../server/proof-request-service.js"
    );
    const result = await rejectProofRequestByHuman({
      proofRequestId: "proof-request-4",
      humanWalletAddress: "mn_addr_preprod1holder",
      reason: "No longer needed",
    });

    expect(result.request_status).toBe("human_rejected");
    expect(result.error_message).toBe("No longer needed");
  });

  it("deletes a proof request for admin cleanup", async () => {
    withTransactionMock.mockImplementation(async (run) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: "proof-request-5",
                did: "did:midnight:preprod:contract:agent",
                request_status: "pending_human_approval",
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return run(client);
    });

    const { deleteProofRequest } = await import("../server/proof-request-service.js");
    const result = await deleteProofRequest({
      proofRequestId: "proof-request-5",
      adminWalletAddress: "mn_addr_preprod1admin",
    });

    expect(result.id).toBe("proof-request-5");
    expect(result.deleted).toBe(true);
    expect(result.deleted_by_wallet).toBe("mn_addr_preprod1admin");
  });
});
