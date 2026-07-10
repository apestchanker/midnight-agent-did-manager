/**
 * Tests for src/lib/did/app-api.ts — application-level orchestration between
 * UnifiedRegistryAPI and the server-side sync endpoints (serviceApi.ts).
 *
 * Task 7 (feature 006-clarify-did-controller-metadata): controller is
 * threaded as its own field through requestDidWithSync/issueDidWithSync/
 * updateDidWithSync, into both the localStorage mergeDidMetadata patch and
 * the corresponding server-sync payload — never derived from didDocument.
 */
import { describe, it, expect, vi, type Mock } from "vitest";

vi.mock("../src/lib/did/cache", () => ({
  mergeDidMetadata: vi.fn((_contractAddress: string, _agentId: string, patch: Record<string, unknown>) => patch),
  getSavedCompileArtifact: vi.fn(() => null),
  saveCompileArtifact: vi.fn(),
  saveDeployment: vi.fn(),
}));

vi.mock("../src/lib/did/service-sync", () => ({
  createWalletDidRequest: vi.fn(async () => ({ id: "req-1" })),
  syncWalletIssuedDidStorage: vi.fn(async () => ({ did: "did:midnight:test" })),
  syncWalletUpdatedDidStorage: vi.fn(async () => ({ did: "did:midnight:test" })),
  syncWalletRevokedDidStorage: vi.fn(async () => ({ did: "did:midnight:test" })),
  getPersistedDidState: vi.fn(async () => ({ request: null, record: null })),
}));

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    contractAddress: "contract-1",
    providers: { networkId: "Undeployed", unshieldedAddress: "addr_test_issuer" },
    requestDid: vi.fn(async () => ({
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      didKeyHex: "aa".repeat(32),
      agentKeyHex: "aa".repeat(32),
      status: "pending_issuance",
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: "2026-07-10T00:00:00.000Z",
      txHash: "0xdeadbeef",
      txId: "txid-001",
      requestCommitmentHex: "req-commit",
      proofCommitmentHex: "proof-commit",
      mode: "onchain",
    })),
    issueDid: vi.fn(async () => ({
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      did: "did:midnight:test",
      agentName: undefined,
      organization: undefined,
      organizationDisclosure: "undisclosed",
      didKeyHex: "aa".repeat(32),
      agentKeyHex: "aa".repeat(32),
      didCommitmentHex: "did-commit",
      documentHashHex: "doc-hash",
      proofCommitmentHex: "proof-commit",
      status: "active",
      proofStatus: "not_requested",
      txStatus: "confirmed",
      createdAt: "2026-07-10T00:00:00.000Z",
      txHash: "0xdeadbeef",
      txId: "txid-001",
      mode: "onchain",
    })),
    updateDid: vi.fn(async () => ({
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      did: "did:midnight:test",
      didKeyHex: "aa".repeat(32),
      agentKeyHex: "aa".repeat(32),
      documentHashHex: "doc-hash",
      proofCommitmentHex: "proof-commit",
      status: "active",
      proofStatus: "verified",
      txStatus: "confirmed",
      createdAt: "2026-07-10T00:00:00.000Z",
      txHash: "0xdeadbeef",
      txId: "txid-001",
      mode: "onchain",
    })),
    ...overrides,
  };
}

describe("Task 7 — controller propagation (app-api.ts)", () => {
  it("requestDidWithSync includes controller in the mergeDidMetadata patch and the createWalletDidRequest body", async () => {
    const cache = await import("../src/lib/did/cache");
    const serviceSync = await import("../src/lib/did/service-sync");
    const { requestDidWithSync } = await import("../src/lib/did/app-api");

    const api = makeApi();
    await requestDidWithSync(api as never, {
      requesterWalletAddress: "mn_addr_wallet",
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      organizationDisclosure: "undisclosed",
      didDocument: "{}",
      controller: "mn_addr_controller_req",
    } as never);

    expect(cache.mergeDidMetadata).toHaveBeenCalledWith(
      "contract-1",
      "agent-1",
      expect.objectContaining({ controller: "mn_addr_controller_req" }),
    );
    expect(serviceSync.createWalletDidRequest).toHaveBeenCalledWith(
      expect.objectContaining({ controller: "mn_addr_controller_req" }),
    );
  });

  it("requestDidWithSync omits controller from the createWalletDidRequest body when not supplied", async () => {
    const serviceSync = await import("../src/lib/did/service-sync");
    const { requestDidWithSync } = await import("../src/lib/did/app-api");

    const api = makeApi();
    await requestDidWithSync(api as never, {
      requesterWalletAddress: "mn_addr_wallet",
      agentId: "agent-2",
      subjectWalletAddress: "mn_addr_subject",
      organizationDisclosure: "undisclosed",
      didDocument: "{}",
    } as never);

    const call = (serviceSync.createWalletDidRequest as Mock).mock.calls.at(-1)?.[0];
    expect(call.controller).toBeUndefined();
  });

  it("issueDidWithSync forwards input.controller into syncWalletIssuedDidStorage", async () => {
    const serviceSync = await import("../src/lib/did/service-sync");
    const { issueDidWithSync } = await import("../src/lib/did/app-api");

    const api = makeApi();
    await issueDidWithSync(api as never, {
      contractAddress: "contract-1",
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      didDocument: '{"@context":"https://www.w3.org/ns/did/v1"}',
      controller: "mn_addr_controller_issue",
    } as never);

    expect(serviceSync.syncWalletIssuedDidStorage).toHaveBeenCalledWith(
      expect.objectContaining({ controller: "mn_addr_controller_issue" }),
    );
  });

  it("updateDidWithSync forwards input.controller into syncWalletUpdatedDidStorage", async () => {
    const serviceSync = await import("../src/lib/did/service-sync");
    const { updateDidWithSync } = await import("../src/lib/did/app-api");

    const api = makeApi();
    await updateDidWithSync(api as never, {
      contractAddress: "contract-1",
      agentId: "agent-1",
      subjectWalletAddress: "mn_addr_subject",
      didDocument: '{"@context":"https://www.w3.org/ns/did/v1"}',
      controller: "mn_addr_controller_update",
    } as never);

    expect(serviceSync.syncWalletUpdatedDidStorage).toHaveBeenCalledWith(
      expect.objectContaining({ controller: "mn_addr_controller_update" }),
    );
  });
});
