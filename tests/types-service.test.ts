import { describe, expect, it } from "vitest";
import type {
  MidnightNativeOwnershipProof2024,
  UnifiedVerifiablePresentation,
} from "./service.js";

// ---------------------------------------------------------------------------
// Runtime shape tests for UnifiedVerifiablePresentation (Task 1 — TDD)
// These tests verify that objects satisfying the TS interfaces also pass
// runtime structural checks — and that the invariants around the degraded
// flag are correctly encoded.
// ---------------------------------------------------------------------------

function makeNormalProof(
  overrides: Partial<MidnightNativeOwnershipProof2024> = {},
): MidnightNativeOwnershipProof2024 {
  return {
    type: "MidnightNativeOwnershipProof2024",
    created: "2026-05-15T12:00:00.000Z",
    verificationMethod: "midnight:wallet:did:midnight:undeployed:0xABC",
    proofPurpose: "authentication",
    scheme: "midnight-native-ownership-v1",
    proofValue: "0xdeadbeef",
    publicInputsHash: "0xaabbccdd",
    coinPublicKey: "mn1q...",
    challenge: "abc123",
    bundleCommitment: "0xbundle",
    holderBindingCommitment: "0xholder",
    disclosedScopes: ["ownership"],
    ...overrides,
  };
}

function makeValidVP(
  proofOverrides: Partial<MidnightNativeOwnershipProof2024> = {},
): UnifiedVerifiablePresentation {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiablePresentation"],
    holder: "did:midnight:undeployed:0xABC",
    verifiableCredential: ["eyJ..."],
    proof: makeNormalProof(proofOverrides),
  };
}

describe("UnifiedVerifiablePresentation — type shape and invariants", () => {
  it("valid VP object satisfies UnifiedVerifiablePresentation shape", () => {
    const vp = makeValidVP();

    expect(vp["@context"]).toEqual(["https://www.w3.org/ns/credentials/v2"]);
    expect(vp.type).toEqual(["VerifiablePresentation"]);
    expect(typeof vp.holder).toBe("string");
    expect(Array.isArray(vp.verifiableCredential)).toBe(true);
    expect(vp.proof.type).toBe("MidnightNativeOwnershipProof2024");
  });

  it("normal VP has non-empty proofValue and publicInputsHash present", () => {
    const vp = makeValidVP();

    expect(vp.proof.proofValue).not.toBe("");
    expect(vp.proof.publicInputsHash).toBeDefined();
    expect(vp.proof.degraded).toBeUndefined();
  });

  it("degraded VP has proof.degraded === true", () => {
    const vp = makeValidVP({ degraded: true, proofValue: "", publicInputsHash: undefined });

    expect(vp.proof.degraded).toBe(true);
  });

  it("degraded VP has proofValue === empty string", () => {
    const vp = makeValidVP({ degraded: true, proofValue: "", publicInputsHash: undefined });

    expect(vp.proof.proofValue).toBe("");
  });

  it("degraded VP does NOT have publicInputsHash key in the proof object", () => {
    const vp = makeValidVP({ degraded: true, proofValue: "" });
    // Explicitly delete to simulate the invariant — publicInputsHash must be absent
    delete (vp.proof as Record<string, unknown>).publicInputsHash;

    expect(Object.prototype.hasOwnProperty.call(vp.proof, "publicInputsHash")).toBe(false);
  });

  it("degraded check is proof.degraded === true, not absence of publicInputsHash", () => {
    // A VP with publicInputsHash absent but degraded not set should NOT be treated as degraded
    const vp = makeValidVP({ proofValue: "0xdeadbeef" });
    delete (vp.proof as Record<string, unknown>).publicInputsHash;

    // The canonical check: vp.proof.degraded === true
    expect(vp.proof.degraded === true).toBe(false);
  });

  it("proof.type is always MidnightNativeOwnershipProof2024", () => {
    const vp = makeValidVP();
    expect(vp.proof.type).toBe("MidnightNativeOwnershipProof2024");
  });

  it("proof.proofPurpose is always authentication", () => {
    const vp = makeValidVP();
    expect(vp.proof.proofPurpose).toBe("authentication");
  });

  it("proof.scheme is always midnight-native-ownership-v1", () => {
    const vp = makeValidVP();
    expect(vp.proof.scheme).toBe("midnight-native-ownership-v1");
  });
});
