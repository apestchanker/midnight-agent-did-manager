import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task 6: serviceApi.ts — assembleVP and verifyUnifiedVPRequest

const MOCK_BASE = "http://localhost:8787";

function mockFetch(respondWith: Record<string, unknown>, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => respondWith,
    text: async () => JSON.stringify(respondWith),
  }));
}

describe("serviceApi Task 6", () => {
  // Intercept the VITE env vars so requestJson uses the default base
  beforeEach(() => {
    // @ts-expect-error vitest globals
    globalThis.__vitest_import_meta_env__ = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("assembleVP", () => {
    it("POSTs to /api/vps/assemble with the correct body and returns the parsed response", async () => {
      const mockVP = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: "did:midnight:test",
        verifiableCredential: ["eyJ.jwt1"],
        proof: {
          type: "MidnightNativeOwnershipProof2024",
          created: "2026-05-15T00:00:00.000Z",
          verificationMethod: "midnight:wallet:did:midnight:test",
          proofPurpose: "authentication",
          scheme: "midnight-native-ownership-v1",
          proofValue: "0xdeadbeef",
          publicInputsHash: "0xabc",
          coinPublicKey: "mn1q",
          challenge: "c1",
          bundleCommitment: "b1",
          holderBindingCommitment: "h1",
          disclosedScopes: ["ownership"],
        },
      };

      const fetchMock = mockFetch(mockVP);
      vi.stubGlobal("fetch", fetchMock);

      const { assembleVP } = await import("../src/utils/serviceApi.js");
      const submission = {
        did: "did:midnight:test",
        challenge: "c1",
        bundleCommitment: "b1",
        holderBindingCommitment: "h1",
        coinPublicKey: "mn1q",
        proof: {
          format: "midnight-zk-proof" as const,
          scheme: "midnight-native-ownership-v1" as const,
          proofValue: "0xdeadbeef",
          publicInputsHash: "0xabc",
        },
      };

      const result = await assembleVP({
        did: "did:midnight:test",
        scopes: ["ownership"],
        challenge: "c1",
        purpose: "selective-disclosure",
        submission,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/vps/assemble");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.did).toBe("did:midnight:test");
      expect(body.scopes).toEqual(["ownership"]);
      expect(body.submission).toEqual(submission);
      expect(result.proof.type).toBe("MidnightNativeOwnershipProof2024");
    });
  });

  describe("verifyUnifiedVPRequest", () => {
    it("POSTs to /api/vps/verify with the VP as the body and returns the parsed response", async () => {
      const mockResult = {
        valid: true,
        status: "native_proof_verified",
        did: "did:midnight:test",
        didActive: true,
        issuerCredentialsVerified: true,
        requestIntegrityVerified: true,
        cryptographicProofVerified: true,
        submissionMatchesRequest: true,
      };

      const fetchMock = mockFetch(mockResult);
      vi.stubGlobal("fetch", fetchMock);

      const { verifyUnifiedVPRequest } = await import("../src/utils/serviceApi.js");
      const vp = {
        "@context": ["https://www.w3.org/ns/credentials/v2"] as ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"] as ["VerifiablePresentation"],
        holder: "did:midnight:test",
        verifiableCredential: ["eyJ.jwt1"],
        proof: {
          type: "MidnightNativeOwnershipProof2024" as const,
          created: "2026-05-15T00:00:00.000Z",
          verificationMethod: "midnight:wallet:did:midnight:test",
          proofPurpose: "authentication" as const,
          scheme: "midnight-native-ownership-v1" as const,
          proofValue: "0xdeadbeef",
          publicInputsHash: "0xabc",
          coinPublicKey: "mn1q",
          challenge: "c1",
          bundleCommitment: "b1",
          holderBindingCommitment: "h1",
          disclosedScopes: ["ownership"],
        },
      };

      const result = await verifyUnifiedVPRequest(vp);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/vps/verify");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.holder).toBe("did:midnight:test");
      expect(body.proof.type).toBe("MidnightNativeOwnershipProof2024");
      expect(result.valid).toBe(true);
      expect(result.status).toBe("native_proof_verified");
    });
  });

  describe("createSignedCredentialBundle removal", () => {
    it("createSignedCredentialBundle is not exported from serviceApi", async () => {
      const serviceApi = await import("../src/utils/serviceApi.js");
      expect((serviceApi as Record<string, unknown>).createSignedCredentialBundle).toBeUndefined();
    });
  });

  describe("recordActionTokenGrant", () => {
    it("POSTs the DB-backed action token grant record", async () => {
      const mockGrant = {
        id: "grant-1",
        customer_id: "customer-1",
        token_contract_address: "token-contract",
        network_id: "Undeployed",
        recipient_shielded_address: "mn_shield-addr_1...",
        credits_granted: 5,
        credits_used: 0,
        status: "active",
        created_at: "2026-06-27T00:00:00.000Z",
        updated_at: "2026-06-27T00:00:00.000Z",
      };
      const fetchMock = mockFetch(mockGrant, 201);
      vi.stubGlobal("fetch", fetchMock);

      const { recordActionTokenGrant } = await import("../src/utils/serviceApi.js");
      const result = await recordActionTokenGrant({
        customerRef: "user@example.com",
        tokenContractAddress: "token-contract",
        networkId: "Undeployed",
        recipientShieldedAddress: "mn_shield-addr_1...",
        subscriptionKeyHex: "ab".repeat(32),
        creditsGranted: 5,
        creditsUsed: 0,
        mintTxHash: "tx-1",
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/action-token-grants");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.customerRef).toBe("user@example.com");
      expect(body.creditsGranted).toBe(5);
      expect(body.creditsUsed).toBe(0);
      expect(body.mintTxHash).toBe("tx-1");
      expect(result.credits_granted).toBe(5);
    });
  });

  describe("verifyMidnightProofRequest removal", () => {
    it("verifyMidnightProofRequest is removed from serviceApi", async () => {
      const serviceApi = await import("../src/utils/serviceApi.js");
      expect((serviceApi as Record<string, unknown>).verifyMidnightProofRequest).toBeUndefined();
    });
  });

  // Task 7 (feature 006-clarify-did-controller-metadata): controller propagated
  // as its own optional field in the POST body of the three wallet-sync
  // endpoints — never derived from didDocument JSON.
  describe("createWalletDidRequest — controller propagation", () => {
    it("POSTs controller in the body when provided", async () => {
      const mockRow = { id: "req-1" };
      const fetchMock = mockFetch(mockRow, 201);
      vi.stubGlobal("fetch", fetchMock);

      const { createWalletDidRequest } = await import("../src/utils/serviceApi.js");
      await createWalletDidRequest({
        walletAddress: "mn_addr_wallet",
        agentId: "agent-1",
        subjectWalletAddress: "mn_addr_subject",
        contractAddress: "contract-1",
        networkId: "Undeployed",
        organizationDisclosure: "undisclosed",
        requestPayload: { agentId: "agent-1" },
        controller: "mn_addr_controller",
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/wallet/did-requests");
      const body = JSON.parse(init.body as string);
      expect(body.controller).toBe("mn_addr_controller");
    });

    it("omits controller from the body when not provided", async () => {
      const mockRow = { id: "req-2" };
      const fetchMock = mockFetch(mockRow, 201);
      vi.stubGlobal("fetch", fetchMock);

      const { createWalletDidRequest } = await import("../src/utils/serviceApi.js");
      await createWalletDidRequest({
        walletAddress: "mn_addr_wallet",
        agentId: "agent-2",
        subjectWalletAddress: "mn_addr_subject",
        contractAddress: "contract-1",
        networkId: "Undeployed",
        organizationDisclosure: "undisclosed",
        requestPayload: { agentId: "agent-2" },
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.controller).toBeUndefined();
    });
  });

  describe("syncWalletIssuedDid — controller propagation", () => {
    it("POSTs controller in the body when provided", async () => {
      const mockRecord = { did: "did:midnight:test" };
      const fetchMock = mockFetch(mockRecord, 200);
      vi.stubGlobal("fetch", fetchMock);

      const { syncWalletIssuedDid } = await import("../src/utils/serviceApi.js");
      await syncWalletIssuedDid({
        issuerWalletAddress: "mn_addr_issuer",
        agentId: "agent-3",
        subjectWalletAddress: "mn_addr_subject",
        contractAddress: "contract-1",
        networkId: "Undeployed",
        did: "did:midnight:test",
        organizationDisclosure: "undisclosed",
        requestPayload: { agentId: "agent-3" },
        didDocument: { "@context": "https://www.w3.org/ns/did/v1" },
        controller: "mn_addr_controller_issue",
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/wallet/dids/issue-sync");
      const body = JSON.parse(init.body as string);
      expect(body.controller).toBe("mn_addr_controller_issue");
    });
  });

  describe("syncWalletUpdatedDid — controller propagation", () => {
    it("POSTs controller in the body when provided", async () => {
      const mockRecord = { did: "did:midnight:test" };
      const fetchMock = mockFetch(mockRecord, 200);
      vi.stubGlobal("fetch", fetchMock);

      const { syncWalletUpdatedDid } = await import("../src/utils/serviceApi.js");
      await syncWalletUpdatedDid({
        did: "did:midnight:test",
        didDocument: { "@context": "https://www.w3.org/ns/did/v1" },
        controller: "mn_addr_controller_update",
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/wallet/dids/update-sync");
      const body = JSON.parse(init.body as string);
      expect(body.controller).toBe("mn_addr_controller_update");
    });

    it("omits controller from the body when not provided (no clobbering)", async () => {
      const mockRecord = { did: "did:midnight:test" };
      const fetchMock = mockFetch(mockRecord, 200);
      vi.stubGlobal("fetch", fetchMock);

      const { syncWalletUpdatedDid } = await import("../src/utils/serviceApi.js");
      await syncWalletUpdatedDid({
        did: "did:midnight:test",
        didDocument: { "@context": "https://www.w3.org/ns/did/v1" },
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.controller).toBeUndefined();
    });
  });

  // Task 9 (feature 007-wallet-nonce-session-auth): wallet-session login flow
  // replaces the shared VITE_DID_API_AUTH_TOKEN / X-DID-API-Key mechanism
  // with a nonce/signature challenge-response exchanged for a session token
  // attached as `Authorization: Bearer <token>` on subsequent requests.
  describe("login", () => {
    function mockWalletApi(signatureOverrides: Partial<{
      data: string;
      signature: string;
      verifyingKey: string;
    }> = {}) {
      const signData = vi.fn(async (data: string) => ({
        data,
        signature: signatureOverrides.signature ?? "sig-hex",
        verifyingKey: signatureOverrides.verifyingKey ?? "verifying-key-hex",
        ...signatureOverrides,
      }));
      return { signData } as unknown as import("@midnight-ntwrk/dapp-connector-api").ConnectedAPI;
    }

    afterEach(async () => {
      const { clearAuthSession } = await import("../src/utils/serviceApi.js");
      clearAuthSession();
    });

    it("removes VITE_DID_API_AUTH_TOKEN / X-DID-API-Key from serviceApi entirely", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(__dirname, "../src/utils/serviceApi.ts"),
        "utf8",
      );
      expect(source).not.toContain("VITE_DID_API_AUTH_TOKEN");
      expect(source).not.toContain("X-DID-API-Key");
    });

    it("requests a challenge, signs it via api.signData, exchanges it for a session, and stores the token", async () => {
      const challenge = JSON.stringify({
        type: "midnight-did:auth-challenge",
        purpose: "wallet-session-login",
        walletAddress: "mn1walletaddress",
        nonce: "nonce-123",
        issuedAt: "2026-07-20T00:00:00.000Z",
        expiresAt: "2026-07-20T00:05:00.000Z",
        domain: "test",
      });
      const nonceResponse = {
        challenge,
        nonce: "nonce-123",
        expiresAt: "2026-07-20T00:05:00.000Z",
      };
      const sessionResponse = {
        token: "session-token-abc",
        walletAddress: "mn1walletaddress",
        isAdmin: false,
        expiresAt: "2026-07-20T00:35:00.000Z",
      };

      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("/api/auth/nonce")) {
          return {
            ok: true,
            status: 200,
            json: async () => nonceResponse,
            text: async () => JSON.stringify(nonceResponse),
          };
        }
        if (String(url).includes("/api/auth/session")) {
          return {
            ok: true,
            status: 200,
            json: async () => sessionResponse,
            text: async () => JSON.stringify(sessionResponse),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { login, getAuthSession } = await import("../src/utils/serviceApi.js");
      const api = mockWalletApi();

      const result = await login(api, "mn1walletaddress");

      // api.signData was called with the exact challenge string returned by
      // the nonce endpoint, using the same call shape as proof approvals.
      expect((api as unknown as { signData: ReturnType<typeof vi.fn> }).signData).toHaveBeenCalledWith(
        challenge,
        { encoding: "text", keyType: "unshielded" },
      );

      // The signed exchange POSTs the signature envelope to /api/auth/session.
      const sessionCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/auth/session"),
      );
      expect(sessionCall).toBeTruthy();
      const [, sessionInit] = sessionCall as [string, RequestInit];
      const sessionBody = JSON.parse(sessionInit.body as string);
      expect(sessionBody.signature).toEqual({
        data: challenge,
        signature: "sig-hex",
        verifyingKey: "verifying-key-hex",
      });

      // The nonce request carried the declared wallet address.
      const nonceCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/auth/nonce"),
      );
      const [, nonceInit] = nonceCall as [string, RequestInit];
      expect(JSON.parse(nonceInit.body as string)).toEqual({
        walletAddress: "mn1walletaddress",
      });

      // The returned token is stored and returned.
      expect(result).toEqual(sessionResponse);
      expect(getAuthSession()).toEqual(sessionResponse);
    });

    it("attaches Authorization: Bearer <token> to subsequent requests after a successful login", async () => {
      const challenge = "challenge-string";
      const nonceResponse = { challenge, nonce: "n1", expiresAt: "2026-07-20T00:05:00.000Z" };
      const sessionResponse = {
        token: "session-token-xyz",
        walletAddress: "mn1walletaddress",
        isAdmin: true,
        expiresAt: "2026-07-20T00:35:00.000Z",
      };
      const backendLogsResponse = { entries: [] };

      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("/api/auth/nonce")) {
          return {
            ok: true,
            status: 200,
            json: async () => nonceResponse,
            text: async () => JSON.stringify(nonceResponse),
          };
        }
        if (String(url).includes("/api/auth/session")) {
          return {
            ok: true,
            status: 200,
            json: async () => sessionResponse,
            text: async () => JSON.stringify(sessionResponse),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => backendLogsResponse,
          text: async () => JSON.stringify(backendLogsResponse),
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { login, fetchBackendLogs } = await import("../src/utils/serviceApi.js");
      await login(mockWalletApi(), "mn1walletaddress");

      await fetchBackendLogs(50);

      const logsCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/admin/logs"),
      );
      expect(logsCall).toBeTruthy();
      const [, logsInit] = logsCall as [string, RequestInit];
      const headers = new Headers(logsInit.headers);
      expect(headers.get("Authorization")).toBe("Bearer session-token-xyz");
      expect(headers.has("X-DID-API-Key")).toBe(false);
    });
  });
});
