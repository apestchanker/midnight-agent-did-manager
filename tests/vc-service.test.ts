import { createHash, randomUUID } from "crypto";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalize } from "../lib/canonical-json.js";
import { getIssuerKeys } from "../server/issuer-keys.js";
import {
  assembleSignedPresentation,
  createMidnightProofMaterialFromRows,
  getIssuerDescriptor,
  verifyCredentialJwt,
  verifyPresentation,
} from "../server/vc-service.js";

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be at module level)
// ---------------------------------------------------------------------------

const verifySignatureMock = vi.fn();
vi.mock("@midnight-ntwrk/ledger-v8", () => ({
  verifySignature: (...args: unknown[]) => verifySignatureMock(...args),
}));

const queryMock = vi.fn();
vi.mock("../server/db.js", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  withTransaction: vi.fn(),
}));

async function createVcJwt(subjectDid: string, claims: Record<string, unknown> = {}) {
  const issuer = await getIssuerKeys();
  const now = Math.floor(Date.now() / 1000);
  const jti = `urn:uuid:${randomUUID()}`;

  const vc = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: jti,
    type: ["VerifiableCredential", "AgentDidOwnershipCredential"],
    issuer: issuer.issuerId,
    validFrom: new Date(now * 1000).toISOString(),
    credentialSubject: {
      id: subjectDid,
      ...claims,
    },
  };

  return new SignJWT({ vc })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "vc+jwt",
      kid: issuer.publicJwk.kid,
    })
    .setIssuer(issuer.issuerId)
    .setSubject(subjectDid)
    .setJti(jti)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime("1h")
    .sign(issuer.privateKey);
}

describe("vc-service", () => {
  it("returns the issuer descriptor", async () => {
    const descriptor = await getIssuerDescriptor();

    expect(descriptor.id).toBe("https://agent-registry.local/issuers/default");
    expect(descriptor.algorithm).toBe("EdDSA");
    expect(descriptor.proofFormat).toBe("vc+jwt");
    expect(descriptor.publicJwk.kid).toContain("#keys-1");
  });

  it("verifies a VC JWT signed by the local issuer", async () => {
    const did =
      "did:midnight:preprod:contract123:agentkey123";
    const jwt = await createVcJwt(did, { walletAddress: "mn_addr_preprod1abc" });

    const verified = await verifyCredentialJwt(jwt);

    expect(verified.payload.iss).toBe("https://agent-registry.local/issuers/default");
    expect(verified.payload.sub).toBe(did);
  });

  it("rejects a presentation with no proof field (structural failure)", async () => {
    const did =
      "did:midnight:preprod:contract123:agentkey123";
    const jwt = await createVcJwt(did, { name: "Agent Smith" });

    const result = await verifyPresentation({
      presentation: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: did,
        verifiableCredential: [jwt],
      },
    });

    expect(result.valid).toBe(false);
    expect((result as { failure_layer?: string }).failure_layer).toBe("structural");
  });

  it("rejects a presentation when credential subject and holder differ", async () => {
    const holderB = "did:midnight:preprod:contract123:subjectB";
    const jwt = await createVcJwt(
      "did:midnight:preprod:contract123:subjectA",
      { name: "Agent Smith" },
    );
    // Build a valid proof for holderB so the test reaches credential subject check
    const payloadDigest = createHash("sha256")
      .update(canonicalize({ holder: holderB, challenge: null, verifier: null, purpose: null, bundleCommitment: null, holderBindingCommitment: null }))
      .digest("hex");
    verifySignatureMock.mockReturnValue(true);

    await expect(
      verifyPresentation({
        presentation: {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiablePresentation"],
          holder: holderB,
          verifiableCredential: [jwt],
          proof: {
            type: "MidnightWalletSignature2024",
            verifyingKey: "vk-test",
            signature: "sig-test",
            payloadDigest,
          },
        },
      }),
    ).rejects.toThrow("Credential subject does not match presentation holder.");
  });

  it("builds deterministic Midnight proof material from credential rows", async () => {
    const did = "did:midnight:preprod:contract123:agentkey123";
    const proofMaterial = await createMidnightProofMaterialFromRows({
      did,
      scopes: ["ownership", "name"],
      challenge: "challenge-123",
      verifier: "https://verifier.example",
      purpose: "selective-disclosure",
      credentialRows: [
        {
          credential_type: "AgentDidOwnershipCredential",
          disclosure_scope: "ownership",
          issuer_id: "https://agent-registry.local/issuers/default",
          subject_did: did,
          claims: {
            walletAddress: "mn_addr_preprod1abc",
            agentKey: "agentkey123",
            contractAddress: "contract123",
          },
          status: "active",
        },
        {
          credential_type: "AgentProfileNameCredential",
          disclosure_scope: "name",
          issuer_id: "https://agent-registry.local/issuers/default",
          subject_did: did,
          claims: {
            name: "Agent Smith",
          },
          status: "active",
        },
      ],
    });

    expect(proofMaterial.proofType).toBe("midnight-credential-commitment");
    expect(proofMaterial.challenge).toBe("challenge-123");
    expect(proofMaterial.disclosedScopes).toEqual(["ownership", "name"]);
    expect(proofMaterial.credentialCount).toBe(2);
    expect(proofMaterial.bundleCommitment).toHaveLength(64);
    expect(proofMaterial.holderBindingCommitment).toHaveLength(64);
    expect(proofMaterial.credentialCommitments[0].claimKeys).toContain("walletAddress");
    expect(proofMaterial.nativeOwnership?.scheme).toBe("midnight-native-ownership-v1");
  });
});

// ---------------------------------------------------------------------------
// verifyPresentation — holderProof validation (TDD: task 5)
// ---------------------------------------------------------------------------

describe("verifyPresentation holderProof validation", () => {
  const did = "did:midnight:preprod:contract123:agentkey123";

  // Fake VC JWT that the query mock will return
  let fakeJwt: string;

  // A fully assembled signed VP (happy-path fixture)
  let signedVp: { presentation: Record<string, unknown> };

  beforeEach(async () => {
    verifySignatureMock.mockReset();
    queryMock.mockReset();

    // Build a real VC JWT with the test issuer
    fakeJwt = await createVcJwt(did, { name: "Test Agent" });

    // Mock getCredentialBundle query result so assembleSignedPresentation
    // can build a VP without hitting a real DB.
    queryMock.mockResolvedValue({
      rows: [{ jwt: fakeJwt }],
    });

    // Construct a valid signed VP via the real implementation.
    // verifySignature is not called during assembly — only during verify.
    const bundleCommitment = "b".repeat(64);
    const holderBindingCommitment = "h".repeat(64);

    signedVp = await assembleSignedPresentation({
      did,
      scopes: ["name"],
      holderSignatureEnvelope: {
        verifyingKey: "vk-" + "a".repeat(60),
        signature: "sig-" + "b".repeat(60),
      },
      holderBindingCommitment,
      challenge: "challenge-test",
      verifier: "https://verifier.example",
      purpose: "authentication",
      bundleCommitment,
    });
  });

  it("returns {valid:false, failure_layer:'structural'} when VP has no proof field", async () => {
    const { proof: _proof, ...vpWithoutProof } = signedVp.presentation as Record<string, unknown>;

    const result = await verifyPresentation({ presentation: vpWithoutProof });

    expect(result.valid).toBe(false);
    expect((result as { failure_layer?: string }).failure_layer).toBe("structural");
  });

  it("returns {valid:false, failure_layer:'structural'} when proof.type is wrong", async () => {
    const tamperedVp = {
      ...signedVp.presentation,
      proof: {
        ...(signedVp.presentation.proof as Record<string, unknown>),
        type: "WrongSignatureType",
      },
    };

    const result = await verifyPresentation({ presentation: tamperedVp });

    expect(result.valid).toBe(false);
    expect((result as { failure_layer?: string }).failure_layer).toBe("structural");
  });

  it("returns {valid:false, failure_layer:'holder_signature'} when payloadDigest is altered", async () => {
    const tamperedVp = {
      ...signedVp.presentation,
      proof: {
        ...(signedVp.presentation.proof as Record<string, unknown>),
        payloadDigest: "altered-" + "0".repeat(56),
      },
    };

    const result = await verifyPresentation({ presentation: tamperedVp });

    expect(result.valid).toBe(false);
    expect((result as { failure_layer?: string }).failure_layer).toBe("holder_signature");
  });

  it("returns {valid:false, failure_layer:'holder_signature'} when signature is tampered", async () => {
    // payloadDigest is valid but verifySignature returns false (tampered signature)
    verifySignatureMock.mockReturnValue(false);

    const result = await verifyPresentation({ presentation: signedVp.presentation });

    expect(result.valid).toBe(false);
    expect((result as { failure_layer?: string }).failure_layer).toBe("holder_signature");
  });

  it("returns {valid:true, holderProofVerified:true} for a correctly assembled VP", async () => {
    verifySignatureMock.mockReturnValue(true);

    const result = await verifyPresentation({ presentation: signedVp.presentation });

    expect(result.valid).toBe(true);
    expect((result as { holderProofVerified?: boolean }).holderProofVerified).toBe(true);
  });
});
