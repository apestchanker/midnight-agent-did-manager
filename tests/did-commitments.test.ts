import { describe, expect, it } from "vitest";
import {
  buildOwnerSignatureDomain,
  createAgentKey,
  createDidIdentifier,
  createDocumentCommitment,
  createRequestCommitment,
  decodeFixedBytes,
  deriveOwnerSecretFromWalletSignature,
  disclosureFlag,
  disclosureFromValue,
  encodeFixedBytes,
  serializeOwnerPrivateState,
} from "../src/lib/did/commitments";

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("did commitments", () => {
  it("creates stable agent keys from normalized agent ids", async () => {
    const one = await createAgentKey("  Agent_Academy  ");
    const two = await createAgentKey("agent_academy");

    expect(toHex(one)).toBe(toHex(two));
    expect(one).toHaveLength(32);
  });

  it("encodes and decodes fixed-width organization labels", () => {
    const encoded = encodeFixedBytes("Matrix Labs", 64);

    expect(encoded).toHaveLength(64);
    expect(decodeFixedBytes(encoded)).toBe("Matrix Labs");
  });

  it("derives disclosure flags and DID identifiers", async () => {
    const did = await createDidIdentifier(
      "preprod",
      "contract123",
      "agentkeyhex",
    );

    expect(did).toBe("did:midnight:preprod:contract123:agentkeyhex");
    expect(disclosureFlag("disclosed")).toBe(1n);
    expect(disclosureFromValue(0n)).toBe("undisclosed");
  });

  it("hashes request and document payloads deterministically", async () => {
    const requestCommitment = await createRequestCommitment({
      contractAddress: "contract123",
      agentId: "agent-academy",
      agentName: "Alice",
      organization: "Matrix Labs",
      organizationDisclosure: "disclosed",
      didDocument: "{\"id\":\"did:midnight:test\"}",
    });
    const documentCommitment = await createDocumentCommitment(
      "{\"id\":\"did:midnight:test\"}",
    );

    expect(requestCommitment).toHaveLength(32);
    expect(documentCommitment).toHaveLength(32);
    expect(toHex(requestCommitment)).not.toBe(toHex(documentCommitment));
  });

  it("derives the owner signature domain from network and deployment salt", () => {
    expect(
      buildOwnerSignatureDomain({
        networkId: "preprod",
        deploymentSaltHex: "AABB",
      }),
    ).toBe("didMN:issuer-owner:v1:preprod:aabb");
  });

  it("derives deterministic owner secrets from wallet signatures", async () => {
    const one = await deriveOwnerSecretFromWalletSignature("ab".repeat(64));
    const two = await deriveOwnerSecretFromWalletSignature("0x" + "ab".repeat(64));
    const other = await deriveOwnerSecretFromWalletSignature("cd".repeat(64));

    expect(one).toHaveLength(32);
    expect(toHex(one)).toBe(toHex(two));
    expect(toHex(one)).not.toBe(toHex(other));
  });

  it("can serialize owner derivation metadata without exporting issuerSecretHex", () => {
    const serialized = serializeOwnerPrivateState(
      {
        createdAt: "2026-06-01T00:00:00.000Z",
        vaultVersion: "v1",
        contractVersion: "0.3.5",
        appVersion: "0.5.2",
        networkId: "preprod",
        custodianWalletAddress: "mn_test_wallet",
        issuerPublicKeyHex: "11".repeat(32),
        ownerDerivation: {
          scheme: "wallet-signature-sha256-v1",
          signDomain: "didMN:issuer-owner:v1:preprod:aa",
          deploymentSaltHex: "aa",
        },
      },
      toHex,
    );

    expect(serialized.issuerSecretHex).toBeUndefined();
    expect(serialized.ownerDerivation?.scheme).toBe("wallet-signature-sha256-v1");
  });
});
