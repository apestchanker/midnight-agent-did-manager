import { describe, expect, it } from "vitest";
import {
  createAgentKey,
  createDidIdentifier,
  createDocumentCommitment,
  createRequestCommitment,
  decodeFixedBytes,
  deriveDidKey,
  disclosureFlag,
  disclosureFromValue,
  encodeFixedBytes,
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

  it("derives DID key from controller public key, subject nonce, and registry salt", () => {
    const controllerKey = new Uint8Array(32).fill(1);
    const subjectNonce = new Uint8Array(32).fill(2);
    const registrySalt = new Uint8Array(32).fill(3);

    const didKey = deriveDidKey(controllerKey, subjectNonce, registrySalt);

    expect(didKey).toHaveLength(32);
    const didKey2 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    expect(toHex(didKey)).toBe(toHex(didKey2));
    const different = deriveDidKey(new Uint8Array(32).fill(9), subjectNonce, registrySalt);
    expect(toHex(didKey)).not.toBe(toHex(different));
  });
});
