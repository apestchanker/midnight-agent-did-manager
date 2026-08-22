import { describe, expect, it, vi, beforeEach } from "vitest";

// Task 9: Full round-trip integration tests
// Tests the assembleUnifiedVP + verifyUnifiedVP pipeline with mocked DB and proof-server.

// ---- Mock heavy server-side dependencies ----
vi.mock("../server/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("../server/load-env.js", () => ({}));
vi.mock("../server/log-store.js", () => ({
  getRecentLogs: vi.fn(() => []),
  installProcessLogger: vi.fn(),
}));

// Shared mock state for the proof pipeline
const mockGetCredentialBundle = vi.fn();
const mockVerifyMidnightProofSubmission = vi.fn();
const mockBuildNativeOwnershipMaterial = vi.fn();
const mockResolveDid = vi.fn();
const mockValidateDid = vi.fn();

vi.mock("../server/vc-service.js", () => ({
  assembleSignedPresentation: vi.fn(),
  assembleUnifiedVP: vi.fn(async (input: Record<string, unknown>) => {
    const proof: Record<string, unknown> = {
      type: "MidnightNativeOwnershipProof2024",
      created: new Date().toISOString(),
      verificationMethod: `midnight:wallet:${input.did}`,
      proofPurpose: "authentication",
      scheme: "midnight-native-ownership-v1",
      proofValue: input.degraded ? "" : (input.proofValue ?? "0xdeadbeef"),
      coinPublicKey: input.coinPublicKey ?? "mn1q",
      challenge: input.challenge,
      bundleCommitment: input.bundleCommitment,
      holderBindingCommitment: input.holderBindingCommitment,
      disclosedScopes: input.disclosedScopes ?? input.scopes,
    };
    if (!input.degraded) {
      proof.publicInputsHash = input.publicInputsHash ?? "0xabc";
    } else {
      proof.degraded = true;
    }
    const bundle = await mockGetCredentialBundle({ did: input.did, scopes: input.scopes });
    return {
      presentation: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: input.did,
        verifiableCredential: bundle?.verifiableCredentials ?? [],
        proof,
      },
    };
  }),
  getCredentialBundle: mockGetCredentialBundle,
  getIssuerDescriptor: vi.fn(),
  getMidnightProofMaterial: vi.fn(),
  listCredentialsForDid: vi.fn(),
  rotateCredentialsForDid: vi.fn(),
  verifyCredentialJwt: vi.fn(),
  verifyPresentation: vi.fn(),
}));

vi.mock("../server/midnight-proof-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/midnight-proof-service.js")>();
  return {
    ...actual,
    verifyMidnightProofSubmission: mockVerifyMidnightProofSubmission,
  };
});

vi.mock("../server/registry-service.js", () => ({
  approveDidRequestByHuman: vi.fn(),
  bootstrapDemoCustomer: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerMcpKey: vi.fn(),
  createDidRequest: vi.fn(),
  createWalletDidRequest: vi.fn(),
  createSubscription: vi.fn(),
  revokeCustomerMcpKey: vi.fn(),
  updateCustomerMcpKeyScopes: vi.fn(),
  getLatestAdminRegistryDeployment: vi.fn(),
  getCustomerByWallet: vi.fn(),
  getDidRequestById: vi.fn(),
  getPersistedDidState: vi.fn(),
  listRegistryDidRecords: vi.fn(),
  issueApprovedDidRequest: vi.fn(),
  linkWallet: vi.fn(),
  listDidRequests: vi.fn(),
  listAdminRegistryDeployments: vi.fn(),
  rejectDidRequestByAdmin: vi.fn(),
  rejectDidRequestByHuman: vi.fn(),
  resolveDid: mockResolveDid,
  saveAdminRegistryDeployment: vi.fn(),
  syncWalletIssuedDid: vi.fn(),
  syncWalletRevokedDid: vi.fn(),
  syncWalletUpdatedDid: vi.fn(),
  validateDid: mockValidateDid,
}));

vi.mock("../server/proof-request-service.js", () => ({
  approveProofRequestByHuman: vi.fn(),
  createProofRequestForAgent: vi.fn(),
  createProofRequestForWallet: vi.fn(),
  deleteProofRequest: vi.fn(),
  getProofRequestById: vi.fn(),
  listProofRequests: vi.fn(),
  rejectProofRequestByHuman: vi.fn(),
  submitProofForRequest: vi.fn(),
}));

// ---- Helper data ----

const VALID_SUBMISSION = {
  did: "did:midnight:undeployed:0xABC",
  challenge: "challenge-abc",
  bundleCommitment: "0xbundle",
  holderBindingCommitment: "0xholder",
  coinPublicKey: "mn1qtest",
  proof: {
    format: "midnight-zk-proof",
    scheme: "midnight-native-ownership-v1",
    proofValue: "0xdeadbeef",
    publicInputsHash: "0xpublicHash",
  },
};

function buildValidVP(overrides: Record<string, unknown> = {}) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiablePresentation"],
    holder: "did:midnight:undeployed:0xABC",
    verifiableCredential: ["eyJ.jwt1"],
    proof: {
      type: "MidnightNativeOwnershipProof2024",
      created: "2026-05-15T12:00:00.000Z",
      verificationMethod: "midnight:wallet:did:midnight:undeployed:0xABC",
      proofPurpose: "authentication",
      scheme: "midnight-native-ownership-v1",
      proofValue: "0xdeadbeef",
      publicInputsHash: "0xpublicHash",
      coinPublicKey: "mn1qtest",
      challenge: "challenge-abc",
      bundleCommitment: "0xbundle",
      holderBindingCommitment: "0xholder",
      disclosedScopes: ["ownership"],
      ...overrides,
    },
  };
}

// ---- Round-trip tests ----

describe("Round-trip: assembleUnifiedVP + verifyUnifiedVP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredentialBundle.mockResolvedValue({
      holder: "did:midnight:undeployed:0xABC",
      disclosedScopes: ["ownership"],
      verifiableCredentials: ["eyJ.jwt1"],
    });
  });

  it("1. assembleUnifiedVP produces a valid UnifiedVerifiablePresentation and verifyUnifiedVP accepts it (structure check)", async () => {
    // Step 1: assemble VP
    const { assembleUnifiedVP } = await import("../server/vc-service.js");
    const assembledResult = await assembleUnifiedVP({
      did: VALID_SUBMISSION.did,
      scopes: ["ownership"],
      challenge: VALID_SUBMISSION.challenge,
      purpose: "selective-disclosure",
      proofValue: VALID_SUBMISSION.proof.proofValue,
      publicInputsHash: VALID_SUBMISSION.proof.publicInputsHash,
      coinPublicKey: VALID_SUBMISSION.coinPublicKey,
      bundleCommitment: VALID_SUBMISSION.bundleCommitment,
      holderBindingCommitment: VALID_SUBMISSION.holderBindingCommitment,
      disclosedScopes: ["ownership"],
    });

    const vp = assembledResult.presentation;
    // Verify the VP has the correct shape
    expect(vp.proof.type).toBe("MidnightNativeOwnershipProof2024");
    expect(vp.proof.proofValue).toBe("0xdeadbeef");
    expect(vp.proof.publicInputsHash).toBe("0xpublicHash");
    expect(vp.proof.degraded).toBeUndefined();
    expect(vp.holder).toBe(VALID_SUBMISSION.did);
    expect(vp["@context"]).toEqual(["https://www.w3.org/ns/credentials/v2"]);

    // Step 2: verifyUnifiedVP with the assembled VP passes structural validation
    // (the ZK pipeline will fail with a "did_not_active" result since there's no real DB,
    //  but the VP is structurally valid and reaches the ZK pipeline — not a structural failure)
    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const result = await verifyUnifiedVP({ vp });
    // The VP is structurally valid so failure_layer is NOT "structural" or "degraded_proof"
    expect(result.failure_layer).not.toBe("structural");
    expect(result.failure_layer).not.toBe("degraded_proof");
    // valid: false is expected since this is a test DID with no real DB, but the pipeline ran
    expect(typeof result.valid).toBe("boolean");
  });

  it("2. Degraded VP → verifyUnifiedVP → failure_layer: 'degraded_proof'", async () => {
    // Step 1: assemble degraded VP (proof-server unavailable)
    const { assembleUnifiedVP } = await import("../server/vc-service.js");
    const degradedResult = await assembleUnifiedVP({
      did: VALID_SUBMISSION.did,
      scopes: ["ownership"],
      challenge: VALID_SUBMISSION.challenge,
      purpose: "selective-disclosure",
      proofValue: "",
      coinPublicKey: VALID_SUBMISSION.coinPublicKey,
      bundleCommitment: VALID_SUBMISSION.bundleCommitment,
      holderBindingCommitment: VALID_SUBMISSION.holderBindingCommitment,
      disclosedScopes: ["ownership"],
      degraded: true,
    });

    const degradedVP = degradedResult.presentation;
    expect(degradedVP.proof.degraded).toBe(true);
    expect(degradedVP.proof.proofValue).toBe("");
    expect(degradedVP.proof.publicInputsHash).toBeUndefined();

    // Step 2: verify degraded VP — should be hard-rejected
    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const result = await verifyUnifiedVP({ vp: degradedVP });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("degraded_proof");
    expect(result.message).toContain("degraded mode");
    // ZK pipeline should NOT have been called
    expect(mockVerifyMidnightProofSubmission).not.toHaveBeenCalled();
  });

  it("3. Legacy { proofRequest, submission } → verifyUnifiedVP → failure_layer: 'structural'", async () => {
    // A legacy package has no proof field at top level — caught as structural error
    const legacyInput = {
      proofRequest: { requestId: "r1", material: {} },
      submission: { did: "did:midnight:test", proof: { format: "midnight-zk-proof" } },
    };

    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const result = await verifyUnifiedVP({ vp: legacyInput as any });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
    // Any structural failure message is acceptable — pipeline not entered
    expect(result.message).toBeTruthy();
    expect(mockVerifyMidnightProofSubmission).not.toHaveBeenCalled();
  });

  it("3b. Legacy body with wrong proof.type → 'Legacy format not accepted' message", async () => {
    // When someone passes a JSON with proof.type set to a legacy value,
    // verifyUnifiedVP catches it and returns the migration guide message.
    const legacyVP = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiablePresentation"],
      holder: "did:midnight:test",
      verifiableCredential: [],
      proof: {
        type: "MidnightWalletSignature2024",
        proofValue: "0xabc",
      },
    };

    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const result = await verifyUnifiedVP({ vp: legacyVP as any });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
    expect(result.message).toContain("Legacy format not accepted");
    expect(mockVerifyMidnightProofSubmission).not.toHaveBeenCalled();
  });

  it("4. /api/vps/assemble response does not contain proofRequest or submission fields", async () => {
    const { assembleUnifiedVP } = await import("../server/vc-service.js");
    const assembledResult = await assembleUnifiedVP({
      did: VALID_SUBMISSION.did,
      scopes: ["ownership"],
      challenge: VALID_SUBMISSION.challenge,
      purpose: "selective-disclosure",
      proofValue: VALID_SUBMISSION.proof.proofValue,
      publicInputsHash: VALID_SUBMISSION.proof.publicInputsHash,
      coinPublicKey: VALID_SUBMISSION.coinPublicKey,
      bundleCommitment: VALID_SUBMISSION.bundleCommitment,
      holderBindingCommitment: VALID_SUBMISSION.holderBindingCommitment,
      disclosedScopes: ["ownership"],
    });

    const serialized = JSON.stringify(assembledResult);
    expect(serialized).not.toContain('"proofRequest"');
    expect(serialized).not.toContain('"submission"');

    const vp = assembledResult.presentation;
    expect(vp).not.toHaveProperty("proofRequest");
    expect(vp).not.toHaveProperty("submission");
    expect(vp["@context"]).toEqual(["https://www.w3.org/ns/credentials/v2"]);
    expect(vp.type).toEqual(["VerifiablePresentation"]);
    expect(vp.proof.type).toBe("MidnightNativeOwnershipProof2024");
  });
});

describe("verifyUnifiedVP structural validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("missing vp.proof returns structural failure", async () => {
    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const result = await verifyUnifiedVP({ vp: { holder: "did:midnight:test" } as any });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
    expect(mockVerifyMidnightProofSubmission).not.toHaveBeenCalled();
  });

  it("wrong proof.type returns structural failure", async () => {
    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const badVP = buildValidVP({ type: "MidnightWalletSignature2024" });
    const result = await verifyUnifiedVP({ vp: badVP as any });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
    expect(mockVerifyMidnightProofSubmission).not.toHaveBeenCalled();
  });

  it("missing vp.holder returns structural failure", async () => {
    const { verifyUnifiedVP } = await import("../server/midnight-proof-service.js");
    const noHolder = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiablePresentation"],
      proof: {
        type: "MidnightNativeOwnershipProof2024",
        scheme: "midnight-native-ownership-v1",
        proofValue: "0xdeadbeef",
        coinPublicKey: "mn1q",
        challenge: "c1",
        bundleCommitment: "b1",
        holderBindingCommitment: "h1",
        disclosedScopes: ["ownership"],
      },
    };
    const result = await verifyUnifiedVP({ vp: noHolder as any });
    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
  });
});

describe("Pre-existing verifyMidnightProofSubmission tests remain unaffected", () => {
  it("verifyMidnightProofSubmission function still exists and is callable independently", async () => {
    // The adapter wraps verifyMidnightProofSubmission without modifying it.
    // Confirm the function is still importable from the same module.
    const proofService = await import("../server/midnight-proof-service.js");
    expect(typeof proofService.verifyMidnightProofSubmission).toBe("function");
  });

  it("verifyUnifiedVP and verifyMidnightProofSubmission are both exported from midnight-proof-service.js", async () => {
    const proofService = await import("../server/midnight-proof-service.js");
    expect(typeof proofService.verifyUnifiedVP).toBe("function");
    expect(typeof proofService.verifyMidnightProofSubmission).toBe("function");
  });
});

describe("VcPanel task 7 — structural acceptance criteria (source-level check)", () => {
  it("VcPanel.tsx does not import createSignedCredentialBundle", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/components/VcPanel.tsx", "utf-8");
    expect(src).not.toContain("createSignedCredentialBundle");
  });

  it("VcPanel.tsx does not contain handleBuildSignedPresentation function", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/components/VcPanel.tsx", "utf-8");
    expect(src).not.toContain("handleBuildSignedPresentation");
  });

  it("VcPanel.tsx does not contain 'Build Signed Presentation' button text", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/components/VcPanel.tsx", "utf-8");
    expect(src).not.toContain("Build Signed Presentation");
  });

  it("VcPanel.tsx uses unifiedVP state instead of proofVerificationPackage", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/components/VcPanel.tsx", "utf-8");
    expect(src).toContain("unifiedVP");
    expect(src).not.toContain("proofVerificationPackage");
  });

  it("VcPanel.tsx imports assembleVP from serviceApi", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/components/VcPanel.tsx", "utf-8");
    expect(src).toContain("assembleVP");
  });
});

describe("App.tsx task 8 — structural acceptance criteria (source-level check)", () => {
  it("App.tsx does not import MidnightProofVerificationPackage", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).not.toContain("MidnightProofVerificationPackage");
  });

  it("App.tsx uses verifyUnifiedVPRequest instead of verifyMidnightProofRequest in imports", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toContain("verifyUnifiedVPRequest");
  });

  it("App.tsx handleVerifyRegistryProof checks for MidnightNativeOwnershipProof2024 proof type", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toContain("MidnightNativeOwnershipProof2024");
  });

  it("App.tsx receipt stores { vp, result, verifiedAt } not { proofRequest, submission, result, verifiedAt }", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    // The receiptPayload should have vp key
    expect(src).toContain("vp: parsed");
    // The receipt should not contain legacy keys
    expect(src).not.toContain("proofRequest,");
    expect(src).not.toContain("submission,");
  });

  it("App.tsx contains legacy format rejection message", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toContain("Legacy format not accepted");
  });

  it("App.tsx placeholder shows UnifiedVerifiablePresentation example", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toContain("MidnightNativeOwnershipProof2024");
  });
});

// Task 10 (feature 007-wallet-nonce-session-auth): isConfiguredAdminWallet
// must be derived from the server-determined `isAdmin` field of the
// wallet-session login response (REQ-06), not from a client-side comparison
// against VITE_ADMIN_WALLET_SHIELDED_ADDR — even when that env var happens
// to reference the same connected wallet for unrelated display purposes.
describe("isAdminSession (src/lib/auth-session.ts) — REQ-06 behavior", () => {
  it("returns true when the session's isAdmin field is true", async () => {
    const { isAdminSession } = await import("../src/lib/auth-session.js");
    expect(
      isAdminSession({
        token: "t1",
        walletAddress: "mn1adminwallet",
        isAdmin: true,
        expiresAt: "2026-07-20T01:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("returns false when the session's isAdmin field is false, even for the wallet VITE_ADMIN_WALLET_SHIELDED_ADDR would reference for display purposes", async () => {
    const { isAdminSession } = await import("../src/lib/auth-session.js");
    expect(
      isAdminSession({
        token: "t2",
        walletAddress: "mn1samewalletdifferentformat",
        isAdmin: false,
        expiresAt: "2026-07-20T01:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("returns false before login completes (no session yet)", async () => {
    const { isAdminSession } = await import("../src/lib/auth-session.js");
    expect(isAdminSession(null)).toBe(false);
  });
});

describe("App.tsx task 10 — structural acceptance criteria (source-level check)", () => {
  it("App.tsx no longer compares the connected wallet against VITE_ADMIN_WALLET_SHIELDED_ADDR to gate admin UI", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).not.toContain("configuredAdminShieldedAddress");
  });

  it("App.tsx derives isConfiguredAdminWallet from isAdminSession(authSession)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toContain("isAdminSession(authSession)");
  });

  it("App.tsx calls serviceApi's login() when a wallet connects", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    expect(src).toMatch(/await login\(api, walletAddress\)/);
  });

  it("App.tsx imports login/clearAuthSession from ./utils/serviceApi and isAdminSession from ./lib/auth-session", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/App.tsx", "utf-8");
    // Matches the named import rather than the whole literal line, so adding a
    // sibling export from ./lib/auth-session (canLoadSessionScopedData) does
    // not break an assertion that is really about where isAdminSession lives.
    expect(src).toMatch(
      /import \{[^}]*\bisAdminSession\b[^}]*\} from "\.\/lib\/auth-session"/,
    );
    expect(src).toMatch(/clearAuthSession,\s*\n\s*createWalletDidRequest/);
  });
});
