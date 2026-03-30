import { randomUUID } from "crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { getIssuerKeys } from "../server/issuer-keys.js";
import {
  getIssuerDescriptor,
  verifyCredentialJwt,
  verifyPresentation,
} from "../server/vc-service.js";

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

  it("verifies a presentation when all credential subjects match the holder", async () => {
    const did =
      "did:midnight:preprod:contract123:agentkey123";
    const jwt = await createVcJwt(did, { name: "Agent Smith" });

    const verified = await verifyPresentation({
      presentation: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiablePresentation"],
        holder: did,
        verifiableCredential: [jwt],
      },
    });

    expect(verified.valid).toBe(true);
    expect(verified.holder).toBe(did);
    expect(verified.credentialCount).toBe(1);
  });

  it("rejects a presentation when credential subject and holder differ", async () => {
    const jwt = await createVcJwt(
      "did:midnight:preprod:contract123:subjectA",
      { name: "Agent Smith" },
    );

    await expect(
      verifyPresentation({
        presentation: {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiablePresentation"],
          holder: "did:midnight:preprod:contract123:subjectB",
          verifiableCredential: [jwt],
        },
      }),
    ).rejects.toThrow("Credential subject does not match presentation holder.");
  });
});
