import { describe, expect, it, vi, afterEach } from "vitest";
import { createLocalPreviewProofSubmission } from "../lib/midnight-proof-envelope.js";
import { buildNativeOwnershipProofInputs } from "../lib/native-ownership-proof.js";
import {
  createMidnightProofRequest,
  verifyMidnightProofSubmission,
} from "../server/midnight-proof-service.js";
import { createMidnightProofMaterialFromRows } from "../server/vc-service.js";
import * as LedgerV8 from "@midnight-ntwrk/ledger-v8";

// ---------------------------------------------------------------------------
// Helpers shared by the ZK-pipeline unit tests (tasks 7 & 8)
// ---------------------------------------------------------------------------

const ZK_DID =
  "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba";

const ZK_CREDENTIAL_ROWS = [
  {
    disclosure_scope: "ownership",
    credential_type: "AgentDidOwnershipCredential",
    issuer_id: "issuer-1",
    subject_did: ZK_DID,
    claims: {
      walletAddress:
        "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
      agentKey:
        "a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
      contractAddress:
        "e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740",
      networkId: "preprod",
      registryStatus: "active",
    },
    jwt: "jwt-1",
    status: "active",
  },
];

/** Build valid proofRequest + matching submission scaffold for the ZK pipeline. */
async function buildZkScaffold(overrides: {
  coinPublicKey?: string | Uint8Array;
  keyLocation?: string;
  proofValue?: string;
  publicInputsHash?: string;
} = {}) {
  const material = await createMidnightProofMaterialFromRows({
    did: ZK_DID,
    scopes: ["ownership"],
    challenge: "challenge-native",
    verifier: "https://verifier.example",
    purpose: "selective-disclosure",
    credentialRows: ZK_CREDENTIAL_ROWS,
  });

  const proofRequest = {
    requestId: "mpr_zk_test",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    proofRequestType: "midnight-holder-proof-request",
    material,
  };

  const submission = {
    did: ZK_DID,
    challenge: "challenge-native",
    bundleCommitment: material.nativeOwnership.bundleCommitment,
    holderBindingCommitment: material.nativeOwnership.holderBindingCommitment,
    proof: {
      format: "midnight-zk-proof" as const,
      scheme: "midnight-native-ownership-v1" as const,
      proofValue: overrides.proofValue ?? "0102",
      // coinPublicKey drives ZK pipeline entry when present
      ...(overrides.coinPublicKey !== undefined
        ? { coinPublicKey: overrides.coinPublicKey }
        : {}),
      ...(overrides.keyLocation !== undefined
        ? { keyLocation: overrides.keyLocation }
        : {}),
      ...(overrides.publicInputsHash !== undefined
        ? { publicInputsHash: overrides.publicInputsHash }
        : {}),
    },
  };

  return { material, proofRequest, submission };
}

/** Standard deps that pass DID / credential checks cleanly. */
function buildZkDeps(extra: Record<string, unknown> = {}) {
  return {
    validateDid: vi.fn(async () => ({ valid: true, status: "active" })),
    listCredentialsForDid: vi.fn(async () => ZK_CREDENTIAL_ROWS),
    verifyCredentialJwt: vi.fn(async () => ({ issuer: "issuer-1" })),
    ...extra,
  };
}

describe("midnight-proof-service", () => {
  it("creates a proof request object around Midnight proof material", async () => {
    const request = await createMidnightProofRequest({
      did: "did:midnight:preprod:contract:agent",
      scopes: ["ownership"],
      challenge: "challenge-1",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
    }, {
      getMidnightProofMaterial: vi.fn(async () => ({
        did: "did:midnight:preprod:contract:agent",
        holder: "did:midnight:preprod:contract:agent",
        network: "midnight",
        proofType: "midnight-credential-commitment",
        challenge: "challenge-1",
        verifier: "https://verifier.example",
        purpose: "selective-disclosure",
        disclosedScopes: ["ownership"],
        credentialCount: 1,
        credentialCommitments: [],
        bundleCommitment: "a".repeat(64),
        holderBindingCommitment: "b".repeat(64),
        verificationHints: {
          statusCheck: "resolve-did-and-check-active",
          issuerCheck: "verify-vc-jwt-signatures",
          holderBinding: "holder-binding-midnight-proof-required",
        },
      })),
    });

    expect(request.proofRequestType).toBe("midnight-holder-proof-request");
    expect(request.material.challenge).toBe("challenge-1");
    expect(request.material.disclosedScopes).toEqual(["ownership"]);
    expect(request.instructions.length).toBeGreaterThan(0);
  });

  it("verifies the proof boundary, DID status, and issuer signatures", async () => {
    const did = "did:midnight:preprod:contract:agent";
    const credentialRows = [
      {
        disclosure_scope: "ownership",
        credential_type: "AgentDidOwnershipCredential",
        issuer_id: "issuer-1",
        subject_did: did,
        claims: {
          walletAddress: "mn_addr_preprod1abc",
        },
        jwt: "jwt-1",
        status: "active",
      },
    ];
    const material = await createMidnightProofMaterialFromRows({
      did,
      scopes: ["ownership"],
      challenge: "challenge-1",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
      credentialRows,
    });
    const proofRequest = {
      requestId: "mpr_test",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      proofRequestType: "midnight-holder-proof-request",
      material,
    };

    const verification = await verifyMidnightProofSubmission(
      {
        proofRequest,
        submission: {
          did,
          challenge: "challenge-1",
          bundleCommitment: proofRequest.material.bundleCommitment,
          holderBindingCommitment: proofRequest.material.holderBindingCommitment,
          proof: {
            format: "midnight-zk-proof",
            proofValue: "opaque-proof-value",
          },
        },
      },
      {
        validateDid: vi.fn(async () => ({
          valid: true,
          status: "active",
        })),
        listCredentialsForDid: vi.fn(async () => credentialRows),
        verifyCredentialJwt: vi.fn(async () => ({
          issuer: "issuer-1",
        })),
      },
    );

    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("boundary_verified_only");
    expect(verification.didActive).toBe(true);
    expect(verification.issuerCredentialsVerified).toBe(true);
    expect(verification.cryptographicProofVerified).toBe(false);
  });

  it("accepts proof requests whose credential commitment object keys arrive in a different order", async () => {
    const did = "did:midnight:preprod:contract:agent";
    const credentialRows = [
      {
        disclosure_scope: "ownership",
        credential_type: "AgentDidOwnershipCredential",
        issuer_id: "issuer-1",
        subject_did: did,
        claims: {
          walletAddress: "mn_addr_preprod1abc",
          agentKey: "agent-key-1",
        },
        jwt: "jwt-1",
        status: "active",
      },
    ];
    const material = await createMidnightProofMaterialFromRows({
      did,
      scopes: ["ownership"],
      challenge: "challenge-1",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
      credentialRows,
    });
    const reorderedCommitments = material.credentialCommitments.map((item) => ({
      scope: item.scope,
      claimKeys: item.claimKeys,
      commitment: item.commitment,
      credentialType: item.credentialType,
    }));

    const verification = await verifyMidnightProofSubmission(
      {
        proofRequest: {
          requestId: "mpr_test",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          proofRequestType: "midnight-holder-proof-request",
          material: {
            ...material,
            credentialCommitments: reorderedCommitments,
          },
        },
        submission: {
          did,
          challenge: "challenge-1",
          bundleCommitment: material.bundleCommitment,
          holderBindingCommitment: material.holderBindingCommitment,
          proof: {
            format: "midnight-zk-proof",
            proofValue: "opaque-proof-value",
          },
        },
      },
      {
        validateDid: vi.fn(async () => ({
          valid: true,
          status: "active",
        })),
        listCredentialsForDid: vi.fn(async () => credentialRows),
        verifyCredentialJwt: vi.fn(async () => ({
          issuer: "issuer-1",
        })),
      },
    );

    expect(verification.valid).toBe(true);
    expect(verification.requestIntegrityVerified).toBe(true);
  });

  it("verifies a local preview proof envelope against the approved request boundary", async () => {
    const did = "did:midnight:preprod:contract:agent";
    const credentialRows = [
      {
        disclosure_scope: "ownership",
        credential_type: "AgentDidOwnershipCredential",
        issuer_id: "issuer-1",
        subject_did: did,
        claims: {
          walletAddress: "mn_addr_preprod1abc",
          agentKey: "agent-key-1",
        },
        jwt: "jwt-1",
        status: "active",
      },
    ];
    const material = await createMidnightProofMaterialFromRows({
      did,
      scopes: ["ownership"],
      challenge: "challenge-1",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
      credentialRows,
    });
    const proofRequest = {
      requestId: "mpr_test",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      proofRequestType: "midnight-holder-proof-request",
      material,
    };
    const submission = await createLocalPreviewProofSubmission({
      proofRequest,
      submission: {
        did,
        challenge: "challenge-1",
        bundleCommitment: material.bundleCommitment,
        holderBindingCommitment: material.holderBindingCommitment,
        proof: {
          format: "midnight-proof-envelope-v1",
          proofValue: "placeholder",
        },
      },
    });

    const verification = await verifyMidnightProofSubmission(
      {
        proofRequest,
        submission,
      },
      {
        validateDid: vi.fn(async () => ({
          valid: true,
          status: "active",
        })),
        listCredentialsForDid: vi.fn(async () => credentialRows),
        verifyCredentialJwt: vi.fn(async () => ({
          issuer: "issuer-1",
        })),
      },
    );

    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("preview_envelope_verified");
    expect(verification.proofEnvelopeVerified).toBe(true);
    expect(verification.cryptographicProofVerified).toBe(false);
  });

  it("verifies a native ownership proof by re-proving the same circuit inputs", async () => {
    const did =
      "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba";
    const credentialRows = [
      {
        disclosure_scope: "ownership",
        credential_type: "AgentDidOwnershipCredential",
        issuer_id: "issuer-1",
        subject_did: did,
        claims: {
          walletAddress:
            "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
          agentKey:
            "a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
          contractAddress:
            "e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740",
          networkId: "preprod",
          registryStatus: "active",
        },
        jwt: "jwt-1",
        status: "active",
      },
    ];
    const material = await createMidnightProofMaterialFromRows({
      did,
      scopes: ["ownership"],
      challenge: "challenge-native",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
      credentialRows,
    });
    const { publicInputsHash } = await buildNativeOwnershipProofInputs({
      did,
      challenge: "challenge-native",
      coinPublicKey: new Uint8Array(32),
      nativeMaterial: material.nativeOwnership,
    });

    const verification = await verifyMidnightProofSubmission(
      {
        proofRequest: {
          requestId: "mpr_native",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          proofRequestType: "midnight-holder-proof-request",
          material,
        },
        submission: {
          did,
          challenge: "challenge-native",
          bundleCommitment: material.nativeOwnership.bundleCommitment,
          holderBindingCommitment: material.nativeOwnership.holderBindingCommitment,
          proof: {
            format: "midnight-zk-proof",
            scheme: "midnight-native-ownership-v1",
            proofValue: "0102",
            publicInputsHash,
          },
        },
      },
      {
        validateDid: vi.fn(async () => ({
          valid: true,
          status: "active",
        })),
        listCredentialsForDid: vi.fn(async () => credentialRows),
        verifyCredentialJwt: vi.fn(async () => ({
          issuer: "issuer-1",
        })),
        isNativeOwnershipVerificationAvailable: vi.fn(() => true),
        checkNativeOwnership: vi.fn(async () => [1n, 2n]),
      },
    );

    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("native_proof_verified");
    expect(verification.cryptographicProofVerified).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Task 8 — ZK pipeline unit tests
  // -------------------------------------------------------------------------

  it("ZK pipeline step 1: returns failure_layer:'structural' when coinPublicKey is empty string", async () => {
    const { proofRequest, submission } = await buildZkScaffold({
      coinPublicKey: "", // present but empty — triggers step 1 failure
    });

    const result = await verifyMidnightProofSubmission(
      { proofRequest, submission },
      buildZkDeps(),
    );

    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("structural");
  });

  it("ZK pipeline step 2: returns failure_layer:'circuit_check' when keyLocation is not 'prove_ownership'", async () => {
    const { proofRequest, submission } = await buildZkScaffold({
      coinPublicKey: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", // valid 32-byte hex
      keyLocation: "wrong_circuit",
    });

    const result = await verifyMidnightProofSubmission(
      { proofRequest, submission },
      buildZkDeps(),
    );

    expect(result.valid).toBe(false);
    expect(result.failure_layer).toBe("circuit_check");
  });

  it("ZK pipeline step 3: returns failure_layer:'zk_blob' when Proof.deserialize throws", async () => {
    const spy = vi.spyOn(LedgerV8.Proof, "deserialize").mockImplementation(() => {
      throw new Error("Invalid proof bytes");
    });

    try {
      const { proofRequest, submission } = await buildZkScaffold({
        coinPublicKey: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        proofValue: "deadbeef",
      });

      const result = await verifyMidnightProofSubmission(
        { proofRequest, submission },
        buildZkDeps(),
      );

      expect(result.valid).toBe(false);
      expect(result.failure_layer).toBe("zk_blob");
    } finally {
      spy.mockRestore();
    }
  });

  it("ZK pipeline step 6 degraded: returns cryptographicProofVerified:false and message containing 'degraded' when proof-server throws", async () => {
    // Proof.deserialize must succeed to reach step 6 — mock it to return a dummy object
    const spy = vi.spyOn(LedgerV8.Proof, "deserialize").mockReturnValue({} as LedgerV8.Proof);

    try {
      const { proofRequest, submission } = await buildZkScaffold({
        coinPublicKey: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      });

      const result = await verifyMidnightProofSubmission(
        { proofRequest, submission },
        buildZkDeps({
          isNativeOwnershipVerificationAvailable: vi.fn(() => true),
          checkNativeOwnership: vi.fn(async () => {
            throw new Error("ECONNREFUSED proof-server not available");
          }),
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.cryptographicProofVerified).toBe(false);
      expect(result.message).toMatch(/degraded/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("ZK pipeline happy path: returns valid:true and cryptographicProofVerified:true when all checks pass", async () => {
    // Proof.deserialize must succeed to reach steps 5-7
    const spy = vi.spyOn(LedgerV8.Proof, "deserialize").mockReturnValue({} as LedgerV8.Proof);

    try {
      const material = await createMidnightProofMaterialFromRows({
        did: ZK_DID,
        scopes: ["ownership"],
        challenge: "challenge-native",
        verifier: "https://verifier.example",
        purpose: "selective-disclosure",
        credentialRows: ZK_CREDENTIAL_ROWS,
      });

      const coinPublicKeyBytes = new Uint8Array(32);
      const { publicInputsHash } = await buildNativeOwnershipProofInputs({
        did: ZK_DID,
        challenge: "challenge-native",
        coinPublicKey: coinPublicKeyBytes,
        nativeMaterial: material.nativeOwnership,
      });

      const proofRequest = {
        requestId: "mpr_happy",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        proofRequestType: "midnight-holder-proof-request",
        material,
      };

      const submission = {
        did: ZK_DID,
        challenge: "challenge-native",
        bundleCommitment: material.nativeOwnership.bundleCommitment,
        holderBindingCommitment: material.nativeOwnership.holderBindingCommitment,
        proof: {
          format: "midnight-zk-proof",
          scheme: "midnight-native-ownership-v1",
          proofValue: "0102",
          coinPublicKey: "0".repeat(64), // 32 zero bytes as hex — matches coinPublicKeyBytes above
          publicInputsHash,
        },
      };

      const result = await verifyMidnightProofSubmission(
        { proofRequest, submission },
        buildZkDeps({
          isNativeOwnershipVerificationAvailable: vi.fn(() => true),
          checkNativeOwnership: vi.fn(async () => undefined),
        }),
      );

      expect(result.valid).toBe(true);
      expect(result.cryptographicProofVerified).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
