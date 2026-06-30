/**
 * Tests for UnifiedRegistryAPI — tasks 5.1 and 5.2.
 *
 * These tests verify the TypeScript layer of the unified contract:
 * - Correct callTx invocations (gated circuits pass coin as first arg)
 * - Pre-check logic (errors thrown before consuming a token)
 * - _buildCoin selects correct color and rejects missing/low balances
 * - Admin-only circuits enforce caller role at the API layer
 *
 * Circuit-level ZK correctness (consumeToken atomicity, on-chain state)
 * is covered by the E2E test (task 5.3) against Preview testnet.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { toHex, fromHex } from "../lib/wallet-bridge";

// Mock localStorage-backed cache so tests can run in Node
vi.mock("../src/lib/did/cache", () => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    getDidMetadata: vi.fn((contractAddress: string, agentId: string) =>
      store.get(`${contractAddress}::${agentId}`) ?? null,
    ),
    mergeDidMetadata: vi.fn(
      (contractAddress: string, agentId: string, patch: Record<string, unknown>) => {
        const key = `${contractAddress}::${agentId}`;
        const existing = store.get(key) ?? {};
        const merged = { ...existing, ...patch, createdAt: existing.createdAt ?? new Date().toISOString() };
        store.set(key, merged);
        return merged;
      },
    ),
    getSavedTokenDeployment: vi.fn(() => null),
    getSavedDeployment: vi.fn(() => null),
    getSavedContractAddress: vi.fn(() => null),
    saveDeployment: vi.fn(),
    saveTokenDeployment: vi.fn(),
    saveCompileArtifact: vi.fn(),
    getSavedCompileArtifact: vi.fn(() => null),
    clearTokenDeployment: vi.fn(),
    __store: store,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_COLOR = "a1".repeat(32);
const MOCK_DID_KEY = new Uint8Array(32).fill(0xdd);
const MOCK_TX = { public: { txHash: "0xdeadbeef", txId: "txid-001" } };
const MOCK_TX_WITH_RESULT = { ...MOCK_TX, result: MOCK_DID_KEY };

function makeModule() {
  return {
    Contract: class {},
    ledger: vi.fn(() => ({
      valid_colors: {
        member: (color: Uint8Array) => toHex(color) === MOCK_COLOR,
        lookup: () => true,
        [Symbol.iterator]: function* () {},
      },
      used_capability_nullifiers: {
        member: () => false,
        lookup: () => false,
        [Symbol.iterator]: function* () {},
      },
      did_controller: {
        member: () => false,
        lookup: () => ({ bytes: new Uint8Array(32) }),
        [Symbol.iterator]: function* () {},
      },
      party_status: {
        member: () => false,
        lookup: () => 0n,
        size: () => 0n,
        isEmpty: () => true,
        [Symbol.iterator]: function* () {},
      },
      admin_registered: false,
      registry_salt: new Uint8Array(32).fill(0xab),
      total_active_dids: 0n,
      registry_nonce: 0n,
      valid_colors_size: 0n,
      role_by_key: {
        member: () => false,
        lookup: () => false,
        [Symbol.iterator]: function* () {},
      },
      did_commitments: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
      document_commitments: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
      proof_commitments: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
      update_cap_commitments: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
      revocation_commitments: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
      did_token_color: {
        member: () => false,
        lookup: () => new Uint8Array(32),
        [Symbol.iterator]: function* () {},
      },
    })),
  };
}

function makeProviders(
  shieldedBalances: Record<string, bigint> = { [MOCK_COLOR]: 5n },
) {
  return {
    networkId: "preview",
    shieldedCoinPublicKeyHex: "cc".repeat(32),
    unshieldedAddress: "addr_test_1234",
    publicDataProvider: {
      queryContractState: vi.fn(async () => ({ data: {} })),
      contractStateObservable: vi.fn(() => ({
        pipe: () => ({ pipe: () => ({}) }),
      })),
    },
    connectedAPI: {
      getShieldedBalances: vi.fn(async () => shieldedBalances),
      getConfiguration: vi.fn(async () => ({})),
      getShieldedAddresses: vi.fn(async () => []),
      getUnshieldedAddress: vi.fn(async () => ({ unshieldedAddress: "addr_test_1234" })),
    },
  };
}

function makeCallTx(overrides: Record<string, unknown> = {}) {
  return {
    gated_self_register_did: vi.fn(async () => MOCK_TX_WITH_RESULT),
    request_update_did: vi.fn(async () => MOCK_TX),
    register_initial_admin: vi.fn(async () => MOCK_TX),
    mint_capability_tokens: vi.fn(async () => MOCK_TX),
    issue_did: vi.fn(async () => MOCK_TX),
    grant_role: vi.fn(async () => MOCK_TX),
    revoke_role: vi.fn(async () => MOCK_TX),
    revoke_did: vi.fn(async () => MOCK_TX),
    ...overrides,
  };
}

// Build a UnifiedRegistryAPI instance bypassing the static factory
// by directly accessing the private constructor via type casting.
async function buildAPI(
  providersOverride?: ReturnType<typeof makeProviders>,
  callTxOverride?: ReturnType<typeof makeCallTx>,
) {
  const { UnifiedRegistryAPI } = await import("../src/lib/registry/unified-registry-api");
  const providers = providersOverride ?? makeProviders();
  const module = makeModule();
  const callTx = callTxOverride ?? makeCallTx();

  // Bypass private constructor using Reflect.construct
  return Reflect.construct(UnifiedRegistryAPI, [
    providers,
    "57c84efb75" + "0".repeat(54),
    module,
    { callTx },
  ]) as InstanceType<typeof UnifiedRegistryAPI>;
}

// ─── REQ-01: gatedSelfRegisterDid — happy path ───────────────────────────────

describe("REQ-01 gatedSelfRegisterDid", () => {
  it("calls gated_self_register_did with coin + subjectNonce", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const subjectNonce = new Uint8Array(32).fill(0x01);

    await api.gatedSelfRegisterDid({
      subjectNonce,
      agentId: "agent-001",
      subjectWalletAddress: "addr_wallet",
      didDocument: "{}",
    });

    expect(callTx.gated_self_register_did).toHaveBeenCalledOnce();
    const [coin, nonce] = (callTx.gated_self_register_did as Mock).mock.calls[0];
    // coin must have color=MOCK_COLOR, value=2n, and a fresh nonce
    expect(toHex(coin.color)).toBe(MOCK_COLOR);
    expect(coin.value).toBe(2n);
    expect(coin.nonce).toHaveLength(32);
    expect(toHex(nonce)).toBe(toHex(subjectNonce));
  });

  it("returns a DidRecord with the did_key from the circuit result", async () => {
    const api = await buildAPI();
    const result = await api.gatedSelfRegisterDid({
      subjectNonce: new Uint8Array(32),
      agentId: "agent-001",
      didDocument: "{}",
    });

    expect(result.didKeyHex).toBe(toHex(MOCK_DID_KEY));
    expect(result.agentId).toBe("agent-001");
    expect(result.status).toBe("pending_issuance");
    expect(result.txHash).toBe("0xdeadbeef");
  });

  it("throws when no verified color has balance >= 2", async () => {
    // Balance exists but only 1 unit (anchor-only, not spendable)
    const providers = makeProviders({ [MOCK_COLOR]: 1n });
    const api = await buildAPI(providers);

    await expect(
      api.gatedSelfRegisterDid({
        subjectNonce: new Uint8Array(32),
        agentId: "agent-001",
      }),
    ).rejects.toThrow("No spendable action credits found");
  });

  it("throws when wallet has no verified colors at all", async () => {
    const providers = makeProviders({ ["ff".repeat(32)]: 10n }); // non-verified color
    const api = await buildAPI(providers);

    await expect(
      api.gatedSelfRegisterDid({
        subjectNonce: new Uint8Array(32),
        agentId: "agent-001",
      }),
    ).rejects.toThrow("No spendable action credits found");
  });

  it("uses a fresh random nonce each invocation (no nonce reuse)", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await api.gatedSelfRegisterDid({ subjectNonce: new Uint8Array(32), agentId: "a" });
    await api.gatedSelfRegisterDid({ subjectNonce: new Uint8Array(32), agentId: "b" });

    const nonce1 = (callTx.gated_self_register_did as Mock).mock.calls[0][0].nonce;
    const nonce2 = (callTx.gated_self_register_did as Mock).mock.calls[1][0].nonce;
    // Two different random nonces (astronomically unlikely to collide)
    expect(toHex(nonce1)).not.toBe(toHex(nonce2));
  });
});

// ─── REQ-01: fetchVerifiedTokenColors reads valid_colors ledger ───────────────

describe("REQ-01 fetchVerifiedTokenColors", () => {
  it("returns the verified color set from ledger valid_colors", async () => {
    const api = await buildAPI();
    const verified = await api.fetchVerifiedTokenColors([MOCK_COLOR, "bb".repeat(32)]);
    expect(verified.has(MOCK_COLOR)).toBe(true);
    expect(verified.has("bb".repeat(32))).toBe(false);
  });

  it("ignores malformed color strings", async () => {
    const api = await buildAPI();
    const verified = await api.fetchVerifiedTokenColors(["not-hex", "too-short"]);
    expect(verified.size).toBe(0);
  });
});

// ─── REQ-03: registerInitialAdmin ────────────────────────────────────────────

describe("REQ-03 registerInitialAdmin", () => {
  it("calls register_initial_admin circuit and returns txHash", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    const result = await api.registerInitialAdmin();

    expect(callTx.register_initial_admin).toHaveBeenCalledOnce();
    expect(result.txHash).toBe("0xdeadbeef");
  });
});

// ─── REQ-02: mintTokens ──────────────────────────────────────────────────────

describe("REQ-02 mintTokens", () => {
  it("calls mint_capability_tokens with subscriptionKey + recipient + nonce + amount", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const recipientBytes = new Uint8Array(32).fill(0xee);

    const { txHash, subscriptionKey } = await api.mintTokens({
      recipientBytes,
      userId: "user@example.com",
      credits: 5n,
    });

    expect(callTx.mint_capability_tokens).toHaveBeenCalledOnce();
    const [subKey, recipient, coinNonce, amount] = (
      callTx.mint_capability_tokens as Mock
    ).mock.calls[0];
    expect(subKey).toHaveLength(32);
    expect(recipient.bytes).toEqual(recipientBytes);
    expect(coinNonce).toHaveLength(32);
    expect(amount).toBe(5n);
    expect(txHash).toBe("0xdeadbeef");
    expect(subscriptionKey).toHaveLength(32);
  });

  it("rejects credits < 1", async () => {
    const api = await buildAPI();
    await expect(
      api.mintTokens({ recipientBytes: new Uint8Array(32), userId: "u", credits: 0n }),
    ).rejects.toThrow("Credits must be >= 1");
  });
});

// ─── REQ-05: request_update_did — pre-checks before consumeToken ──────────────

describe("REQ-05 requestUpdateDid", () => {
  it("calls request_update_did with coin + nonce + commitments", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await api.requestUpdateDid({
      subjectNonce: new Uint8Array(32).fill(0x02),
      docCommitment: new Uint8Array(32).fill(0x03),
      capCommitment: new Uint8Array(32).fill(0x04),
    });

    expect(callTx.request_update_did).toHaveBeenCalledOnce();
    const [coin, nonce, doc, cap] = (callTx.request_update_did as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_COLOR);
    expect(coin.value).toBe(2n);
    expect(nonce).toHaveLength(32);
    expect(doc).toHaveLength(32);
    expect(cap).toHaveLength(32);
  });
});

// ─── REQ-06: revokeDid ───────────────────────────────────────────────────────

describe("REQ-06 revokeDid", () => {
  it("calls revoke_did with coin + did_key derived from agentId metadata", async () => {
    // Seed the mock cache directly
    const cache = await import("../src/lib/did/cache");
    const contractAddress = "57c84efb75" + "0".repeat(54);
    (cache.mergeDidMetadata as Mock)(contractAddress, "agent-revoke", {
      didKeyHex: toHex(MOCK_DID_KEY),
    });

    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await api.revokeDid({ agentId: "agent-revoke", reason: "test" } as never);

    expect(callTx.revoke_did).toHaveBeenCalledOnce();
    const [coin, didKeyArg] = (callTx.revoke_did as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_COLOR);
    expect(toHex(didKeyArg as Uint8Array)).toBe(toHex(MOCK_DID_KEY));
  });

  it("throws when no cached did_key is available", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await expect(
      api.revokeDid({ agentId: "agent-unknown-xyz", reason: "x" } as never),
    ).rejects.toThrow("DID key is missing");
  });
});

// ─── REQ-07: grant/revoke role ───────────────────────────────────────────────

describe("REQ-07 grantRole / revokeRole", () => {
  it("grantRole calls grant_role with coin + didKey + role", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const didKey = new Uint8Array(32).fill(0x11);
    const role = new Uint8Array(32).fill(0x22);

    await api.grantRole({ didKey, role });

    expect(callTx.grant_role).toHaveBeenCalledOnce();
    const [coin, keyArg, roleArg] = (callTx.grant_role as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_COLOR);
    expect(toHex(keyArg as Uint8Array)).toBe(toHex(didKey));
    expect(toHex(roleArg as Uint8Array)).toBe(toHex(role));
  });

  it("revokeRole calls revoke_role with coin + didKey + role", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const didKey = new Uint8Array(32).fill(0x33);
    const role = new Uint8Array(32).fill(0x44);

    await api.revokeRole({ didKey, role });

    expect(callTx.revoke_role).toHaveBeenCalledOnce();
    const [coin, keyArg, roleArg] = (callTx.revoke_role as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_COLOR);
    expect(toHex(keyArg as Uint8Array)).toBe(toHex(didKey));
    expect(toHex(roleArg as Uint8Array)).toBe(toHex(role));
  });
});

// ─── REQ-04: issueDid (non-gated) ────────────────────────────────────────────

describe("REQ-04 issueDid", () => {
  it("calls issue_did with did_key + commitments (no coin)", async () => {
    const cache = await import("../src/lib/did/cache");
    const contractAddress = "57c84efb75" + "0".repeat(54);
    (cache.mergeDidMetadata as Mock)(contractAddress, "agent-issue", {
      didKeyHex: toHex(MOCK_DID_KEY),
    });

    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await api.issueDid({
      agentId: "agent-issue",
      didDocument: '{"@context":"https://www.w3.org/ns/did/v1"}',
    });

    expect(callTx.issue_did).toHaveBeenCalledOnce();
    // issue_did MUST NOT receive a coin — only 4 Uint8Array args
    const args = (callTx.issue_did as Mock).mock.calls[0];
    expect(args).toHaveLength(4);
    for (const arg of args) {
      expect(arg).toBeInstanceOf(Uint8Array);
    }
    // No coin arg (which would be an object with nonce/color/value)
    expect(args.some((a: unknown) => typeof a === "object" && "value" in (a as object))).toBe(false);
  });

  it("throws when no cached did_key", async () => {
    const api = await buildAPI();
    await expect(
      api.issueDid({ agentId: "agent-no-key-xyz", didDocument: "{}" }),
    ).rejects.toThrow("DID key is missing");
  });
});

// ─── REQ-08: Security — gated circuit receives real coin, not commitment ──────

describe("REQ-08 security: coin-based gating replaces commitment-based gating", () => {
  it("gated_self_register_did receives a coin object (not nullifier + commitmentValue)", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    await api.gatedSelfRegisterDid({
      subjectNonce: new Uint8Array(32),
      agentId: "agent-security-test",
    });

    const args = (callTx.gated_self_register_did as Mock).mock.calls[0];
    const coin = args[0];
    // Coin must have nonce, color, value — not nullifier/commitmentValue
    expect(coin).toHaveProperty("nonce");
    expect(coin).toHaveProperty("color");
    expect(coin).toHaveProperty("value");
    expect(coin).not.toHaveProperty("nullifier");
    expect(coin).not.toHaveProperty("commitmentValue");
    expect(args).toHaveLength(2); // coin + subjectNonce only
  });

  it("_buildCoin always generates a fresh nonce (prevents replay at callsite)", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);

    // Call 3 times, collect nonces
    for (let i = 0; i < 3; i++) {
      await api.gatedSelfRegisterDid({ subjectNonce: new Uint8Array(32), agentId: `a${i}` });
    }
    const nonces = (callTx.gated_self_register_did as Mock).mock.calls.map(
      (call) => toHex(call[0].nonce as Uint8Array),
    );
    const unique = new Set(nonces);
    expect(unique.size).toBe(3);
  });

  it("readRegistrySalt reads salt from ledger (used for did_key derivation off-chain)", async () => {
    const api = await buildAPI();
    const salt = await api.readRegistrySalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt).toHaveLength(32);
  });
});
