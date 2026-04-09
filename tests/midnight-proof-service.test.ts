import { describe, expect, it, vi } from "vitest";
import { createLocalPreviewProofSubmission } from "../lib/midnight-proof-envelope.js";
import { buildNativeOwnershipProofInputs } from "../lib/native-ownership-proof.js";
import {
  createMidnightProofRequest,
  verifyMidnightProofSubmission,
} from "../server/midnight-proof-service.js";
import { createMidnightProofMaterialFromRows } from "../server/vc-service.js";

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
        proveNativeOwnership: vi.fn(async () => new Uint8Array([0x01, 0x02])),
      },
    );

    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("native_proof_verified");
    expect(verification.cryptographicProofVerified).toBe(true);
  });
});
