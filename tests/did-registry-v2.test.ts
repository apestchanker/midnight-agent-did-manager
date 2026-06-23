import { describe, it, expect, vi, beforeEach } from "vitest";
import { toHex } from "../lib/wallet-bridge";
import {
  deriveSubjectNonceFromSeed,
  getDefaultSubjectNonce,
  createDidSlotPrivateState,
  isValidDidSlotState,
} from "../src/lib/did/private-state";
import { deriveDidKey } from "../src/lib/did/commitments";
import {
  DEFAULT_SUBJECT_NONCE,
  SLOT_PRIVATE_STATE_ID,
  DID_SUBJECT_NONCE_PREFIX,
} from "../src/lib/did/types";
import {
  createDeploymentPrivateState,
  persistSlotPrivateState,
  getSlotPrivateState,
  getOwnerVaultStatus,
} from "../src/lib/did/vault";

// REQ-01: Subject nonce is SHA-256 of the well-known prefix
describe("REQ-01 default subject nonce", () => {
  it("getDefaultSubjectNonce returns 32 bytes", async () => {
    const nonce = await getDefaultSubjectNonce();
    expect(nonce).toHaveLength(32);
  });

  it("getDefaultSubjectNonce matches DEFAULT_SUBJECT_NONCE constant", async () => {
    const nonce = await getDefaultSubjectNonce();
    expect(toHex(nonce)).toBe(DEFAULT_SUBJECT_NONCE);
  });

  it("DID_SUBJECT_NONCE_PREFIX is the expected string", () => {
    expect(DID_SUBJECT_NONCE_PREFIX).toBe("didmn:default-slot:v1");
  });

  it("deriveSubjectNonceFromSeed creates stable distinct nonces", async () => {
    const first = await deriveSubjectNonceFromSeed("request:one");
    const firstAgain = await deriveSubjectNonceFromSeed("request:one");
    const second = await deriveSubjectNonceFromSeed("request:two");

    expect(first).toHaveLength(32);
    expect(toHex(first)).toBe(toHex(firstAgain));
    expect(toHex(first)).not.toBe(toHex(second));
  });
});

// REQ-02: DidSlotPrivateState creation and validation
describe("REQ-02 slot private state", () => {
  it("createDidSlotPrivateState returns valid state", () => {
    const state = createDidSlotPrivateState({
      networkId: "preprod",
      contractAddress: "addr_test_contract123",
    });
    expect(isValidDidSlotState(state)).toBe(true);
    expect(state.networkId).toBe("preprod");
    expect(state.contractAddress).toBe("addr_test_contract123");
    expect(typeof state.createdAt).toBe("string");
  });

  it("isValidDidSlotState rejects null", () => {
    expect(isValidDidSlotState(null)).toBe(false);
  });

  it("isValidDidSlotState rejects missing networkId", () => {
    expect(isValidDidSlotState({ contractAddress: "x", createdAt: "2024" })).toBe(false);
  });

  it("SLOT_PRIVATE_STATE_ID is did-slot-state:v2", () => {
    expect(SLOT_PRIVATE_STATE_ID).toBe("did-slot-state:v2");
  });
});

// REQ-03: DID key derivation is deterministic and domain-separated
describe("REQ-03 DID key derivation", () => {
  const controllerKey = new Uint8Array(32).fill(1);
  const subjectNonce = new Uint8Array(32).fill(2);
  const registrySalt = new Uint8Array(32).fill(3);

  it("deriveDidKey returns 32 bytes", () => {
    const key = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    expect(key).toHaveLength(32);
  });

  it("deriveDidKey is deterministic", () => {
    const k1 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    const k2 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    expect(toHex(k1)).toBe(toHex(k2));
  });

  it("different controller key produces different DID key", () => {
    const k1 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    const k2 = deriveDidKey(new Uint8Array(32).fill(9), subjectNonce, registrySalt);
    expect(toHex(k1)).not.toBe(toHex(k2));
  });

  it("different subject nonce produces different DID key", () => {
    const k1 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    const k2 = deriveDidKey(controllerKey, new Uint8Array(32).fill(7), registrySalt);
    expect(toHex(k1)).not.toBe(toHex(k2));
  });

  it("different registry salt produces different DID key", () => {
    const k1 = deriveDidKey(controllerKey, subjectNonce, registrySalt);
    const k2 = deriveDidKey(controllerKey, subjectNonce, new Uint8Array(32).fill(5));
    expect(toHex(k1)).not.toBe(toHex(k2));
  });
});

// REQ-04: Vault v2 — no owner secret, stub vault status
describe("REQ-04 vault v2 API", () => {
  const mockProviders = {
    networkId: "preprod",
    privateStateProvider: {
      setContractAddress: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createDeploymentPrivateState returns valid DidSlotPrivateState", async () => {
    const state = await createDeploymentPrivateState(mockProviders as never);
    expect(isValidDidSlotState(state)).toBe(true);
    expect(state.networkId).toBe("preprod");
  });

  it("persistSlotPrivateState calls privateStateProvider.set", async () => {
    const state = createDidSlotPrivateState({ networkId: "preprod", contractAddress: "addr1" });
    await persistSlotPrivateState(mockProviders as never, "addr1", state);
    expect(mockProviders.privateStateProvider.set).toHaveBeenCalledWith(
      SLOT_PRIVATE_STATE_ID,
      state,
    );
  });

  it("getSlotPrivateState returns null when no state exists", async () => {
    const result = await getSlotPrivateState(mockProviders as never, "addr1");
    expect(result).toBeNull();
  });

  it("getSlotPrivateState returns state when valid state exists", async () => {
    const state = createDidSlotPrivateState({ networkId: "preprod", contractAddress: "addr1" });
    mockProviders.privateStateProvider.get.mockResolvedValueOnce(state);
    const result = await getSlotPrivateState(mockProviders as never, "addr1");
    expect(result).not.toBeNull();
    expect(isValidDidSlotState(result)).toBe(true);
  });

  it("getOwnerVaultStatus always returns hasLocalVault false", async () => {
    const status = await getOwnerVaultStatus(mockProviders as never, "addr1");
    expect(status.hasLocalVault).toBe(false);
    expect(status.matchesOnChain).toBeNull();
    expect(status.contractAddress).toBe("addr1");
  });
});
