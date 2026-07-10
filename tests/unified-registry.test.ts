/**
 * Tests for the unified gated DID registry — TypeScript API layer + real
 * contract-simulator (circuit-level) coverage.
 *
 * Two kinds of tests live in this file:
 *
 * 1. TS API-layer tests (UnifiedRegistryAPI, mocked module/ledger/callTx):
 *    verify correct callTx invocations, pre-check logic, coin selection, and
 *    error propagation at the TypeScript orchestration layer. These mock the
 *    generated contract module entirely — they do not exercise real Compact
 *    circuit semantics.
 *
 * 2. Contract-simulator tests (@midnight-ntwrk/compact-runtime, no mocks):
 *    load the real compiled contract from
 *    `../src/generated/didRegistryContract.runtime.js` and execute circuits
 *    directly via `contract.impureCircuits.*` (the same real-execution
 *    pattern this project previously used in its pre-unification
 *    token-gating contract tests, now superseded by this file).
 *    These are the tests that actually prove genesis-mint, consumeAdminToken,
 *    rotate_admin_tokens, and the DID-linked color check behave as specified
 *    in feature 005-coin-gated-admin-access (2-technical/spec.md).
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import * as rt from "@midnight-ntwrk/compact-runtime";
import { toHex, fromHex } from "../lib/wallet-bridge";
import { Contract, ledger as ledgerFn } from "../src/generated/didRegistryContract.runtime.js";

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

// ════════════════════════════════════════════════════════════════════════
// PART 1 — TS API-layer tests (mocked module/ledger/callTx)
// ════════════════════════════════════════════════════════════════════════

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_COLOR = "a1".repeat(32);
// Distinct from MOCK_COLOR — feature 005-coin-gated-admin-access introduces a
// single dedicated admin_token_color, separate from the multi-color
// valid_colors set used by capability tokens.
const MOCK_ADMIN_COLOR = "ad".repeat(32);
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
      // Feature 005-coin-gated-admin-access: single admin color, read by
      // UnifiedRegistryAPI._buildAdminCoin() via exact-equality filtering.
      admin_token_color: fromHex(MOCK_ADMIN_COLOR),
    })),
  };
}

function makeProviders(
  shieldedBalances: Record<string, bigint> = { [MOCK_COLOR]: 5n, [MOCK_ADMIN_COLOR]: 5n },
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
    mint_capability_tokens: vi.fn(async () => MOCK_TX),
    issue_did: vi.fn(async () => MOCK_TX),
    grant_role: vi.fn(async () => MOCK_TX),
    revoke_role: vi.fn(async () => MOCK_TX),
    revoke_did: vi.fn(async () => MOCK_TX),
    rotate_admin_tokens: vi.fn(async () => MOCK_TX),
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

// ─── REQ-01: no client-side bootstrap method exists ──────────────────────────
// register_initial_admin() was removed from the contract (Task 2) and
// registerInitialAdmin() from UnifiedRegistryAPI (Task 7) — the genesis admin
// token is now minted atomically in the constructor. Locks in REQ-01
// Scenario 02 ("no separate bootstrap operation exists") at the client layer.

describe("REQ-01/S02 — no separate bootstrap operation exists (client layer)", () => {
  it("UnifiedRegistryAPI no longer exposes registerInitialAdmin()", async () => {
    const api = await buildAPI();
    expect((api as unknown as Record<string, unknown>).registerInitialAdmin).toBeUndefined();
  });
});

// ─── REQ-02: mintTokens (admin-gated) ────────────────────────────────────────

describe("REQ-02 mintTokens", () => {
  it("calls mint_capability_tokens with an admin coin as first arg, then subscriptionKey + recipient + nonce + amount", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const recipientBytes = new Uint8Array(32).fill(0xee);

    const { txHash, subscriptionKey } = await api.mintTokens({
      recipientBytes,
      userId: "user@example.com",
      credits: 5n,
    });

    expect(callTx.mint_capability_tokens).toHaveBeenCalledOnce();
    const [coin, subKey, recipient, coinNonce, amount] = (
      callTx.mint_capability_tokens as Mock
    ).mock.calls[0];
    // Feature 005-coin-gated-admin-access: first arg is the admin coin
    // obtained from _buildAdminCoin(), colored with admin_token_color.
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
    expect(coin.value).toBe(2n);
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

// ─── REQ-06: revokeDid (admin-gated) ─────────────────────────────────────────

describe("REQ-06 revokeDid", () => {
  it("calls revoke_did with an admin coin + did_key derived from agentId metadata", async () => {
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
    // Feature 005-coin-gated-admin-access: revoke_did now requires an
    // admin-colored coin (via _buildAdminCoin()), not any valid capability color.
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
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

// ─── REQ-07: grant/revoke role (admin-gated) ─────────────────────────────────

describe("REQ-07 grantRole / revokeRole", () => {
  it("grantRole calls grant_role with an admin coin + didKey + role", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const didKey = new Uint8Array(32).fill(0x11);
    const role = new Uint8Array(32).fill(0x22);

    await api.grantRole({ didKey, role });

    expect(callTx.grant_role).toHaveBeenCalledOnce();
    const [coin, keyArg, roleArg] = (callTx.grant_role as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
    expect(toHex(keyArg as Uint8Array)).toBe(toHex(didKey));
    expect(toHex(roleArg as Uint8Array)).toBe(toHex(role));
  });

  it("revokeRole calls revoke_role with an admin coin + didKey + role", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const didKey = new Uint8Array(32).fill(0x33);
    const role = new Uint8Array(32).fill(0x44);

    await api.revokeRole({ didKey, role });

    expect(callTx.revoke_role).toHaveBeenCalledOnce();
    const [coin, keyArg, roleArg] = (callTx.revoke_role as Mock).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
    expect(toHex(keyArg as Uint8Array)).toBe(toHex(didKey));
    expect(toHex(roleArg as Uint8Array)).toBe(toHex(role));
  });
});

// ─── REQ-04: issueDid (admin-gated) ──────────────────────────────────────────

describe("REQ-04 issueDid", () => {
  it("calls issue_did with an admin coin as first arg, then did_key + commitments", async () => {
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
    // Feature 005-coin-gated-admin-access (ADR-004): issue_did gains `coin`
    // as its first parameter — ISSUER role removed, gated by consumeAdminToken().
    const args = (callTx.issue_did as Mock).mock.calls[0];
    expect(args).toHaveLength(5);
    const [coin, ...rest] = args;
    expect(coin).toHaveProperty("nonce");
    expect(coin).toHaveProperty("color");
    expect(coin).toHaveProperty("value");
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
    for (const arg of rest) {
      expect(arg).toBeInstanceOf(Uint8Array);
    }
  });

  it("throws when no cached did_key", async () => {
    const api = await buildAPI();
    await expect(
      api.issueDid({ agentId: "agent-no-key-xyz", didDocument: "{}" }),
    ).rejects.toThrow("DID key is missing");
  });
});

// ─── REQ-04: rotateAdminTokens (admin-gated) ─────────────────────────────────

describe("REQ-04 rotateAdminTokens", () => {
  it("calls rotate_admin_tokens with an admin coin, new recipient, fresh nonce, and newSupply", async () => {
    const callTx = makeCallTx();
    const api = await buildAPI(undefined, callTx);
    const newRecipientBytes = new Uint8Array(32).fill(0x55);

    const result = await api.rotateAdminTokens({ newRecipientBytes, newSupply: 9n });

    expect(callTx.rotate_admin_tokens).toHaveBeenCalledOnce();
    const [coin, recipient, newCoinNonce, newSupply] = (
      callTx.rotate_admin_tokens as Mock
    ).mock.calls[0];
    expect(toHex(coin.color)).toBe(MOCK_ADMIN_COLOR);
    expect(recipient.bytes).toEqual(newRecipientBytes);
    expect(newCoinNonce).toHaveLength(32);
    expect(newSupply).toBe(9n);
    expect(result.txHash).toBe("0xdeadbeef");
  });

  it("throws when no admin-colored coin has balance >= 2", async () => {
    const providers = makeProviders({ [MOCK_COLOR]: 5n }); // no admin color at all
    const api = await buildAPI(providers);

    await expect(
      api.rotateAdminTokens({ newRecipientBytes: new Uint8Array(32), newSupply: 3n }),
    ).rejects.toThrow("No spendable admin credits found");
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

// ════════════════════════════════════════════════════════════════════════
// PART 2 — Contract-simulator tests (real @midnight-ntwrk/compact-runtime
// execution against the compiled did-registry contract — no mocks).
// ════════════════════════════════════════════════════════════════════════

// CoinPublicKey must be { bytes: Uint8Array<32> } — plain Uint8Array causes
// ownPublicKey() to fail. dummyUserAddress() needs no WASM from ledger-v8.
const COIN_PK: { bytes: Uint8Array } = {
  bytes: new Uint8Array(Buffer.from(rt.dummyUserAddress(), "hex")),
};

/** Deterministic 32-byte value from a small integer seed — unique within a single test. */
function seedBytes(seed: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = seed & 0xff;
  b[1] = (seed >> 8) & 0xff;
  b[2] = 0x5e; // constant tag, avoids accidental all-zero collisions with seed=0
  return b;
}

/** Deploys a fresh contract instance with the given (or default) constructor args. */
function deploy(
  opts: {
    adminSupply?: bigint;
    recipient?: { bytes: Uint8Array };
    coinNonce?: Uint8Array;
    salt?: Uint8Array;
  } = {},
) {
  const contract = new Contract({});
  const ctorCtx = rt.createConstructorContext({}, COIN_PK);
  const init = contract.initialState(
    ctorCtx,
    opts.salt ?? seedBytes(9001),
    opts.recipient ?? COIN_PK,
    opts.coinNonce ?? seedBytes(9002),
    opts.adminSupply ?? 10n,
  );
  return { contract, init };
}

/** Fresh circuit context rooted at the given contract state. */
function makeCtx(state: rt.ChargedState | rt.StateValue) {
  return rt.createCircuitContext(
    rt.dummyContractAddress(),
    rt.emptyZswapLocalState(COIN_PK),
    state,
    {},
  );
}

type SimCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/**
 * Runs a named impure circuit against `state` and returns result/outputs/next-state.
 *
 * `receiveShielded()` + `sendImmediateShielded()` (used by consumeToken/
 * consumeAdminToken/rotate_admin_tokens's burn step) each produce Zswap
 * outputs beyond the one the *caller* can actually spend: a full-value
 * "custody" output owned by the contract itself (from receiveShielded) and,
 * when applicable, a 1-unit "residual" output also owned by the contract
 * (the processing-cost unit retained by sendShielded's own change logic).
 * Only outputs whose `recipient.is_left` is true are paid to the calling
 * user's own coin public key and are therefore spendable by the caller in a
 * follow-up call — those are what these tests care about. `outputs` below is
 * pre-filtered to exactly that spendable subset, in call order.
 */
function run(
  contract: InstanceType<typeof Contract>,
  state: rt.ChargedState | rt.StateValue,
  name: string,
  ...args: unknown[]
): { result: unknown; outputs: SimCoin[]; state: rt.StateValue } {
  const ctx = makeCtx(state);
  const impure = contract.impureCircuits as unknown as Record<
    string,
    (
      ctx: unknown,
      ...a: unknown[]
    ) => {
      result: unknown;
      context: {
        currentZswapLocalState: { outputs: { coinInfo: SimCoin; recipient: { is_left: boolean } }[] };
        currentQueryContext: { state: rt.StateValue };
      };
    }
  >;
  const raw = impure[name](ctx, ...args);
  return {
    result: raw.result,
    outputs: raw.context.currentZswapLocalState.outputs
      .filter((o) => o.recipient.is_left)
      .map((o) => o.coinInfo),
    state: raw.context.currentQueryContext.state,
  };
}

// ─── REQ-01: genesis admin token minted at deploy ────────────────────────────

describe("REQ-01 — genesis admin token minted atomically at deploy", () => {
  it("S01: mints admin_supply + 1 units directly to admin_recipient and sets admin_token_color", () => {
    const { init } = deploy({ adminSupply: 7n });
    const l = ledgerFn(init.currentContractState.data);

    expect(l.admin_token_color).toBeInstanceOf(Uint8Array);
    expect(l.admin_token_color).toHaveLength(32);
    expect(l.admin_registered).toBe(true);

    const genesisCoin = init.currentZswapLocalState.outputs[0].coinInfo;
    expect(genesisCoin.value).toBe(8n); // 7 + 1 anchor
    expect(toHex(genesisCoin.color)).toBe(toHex(l.admin_token_color));
  });

  it("rejects admin_supply = 0 at deploy (no degenerate zero-credit genesis)", () => {
    expect(() => deploy({ adminSupply: 0n })).toThrow("admin_supply must be at least 1");
  });

  it("S02: no register_initial_admin circuit exists on the compiled contract", () => {
    const { contract } = deploy();
    expect((contract.circuits as Record<string, unknown>).register_initial_admin).toBeUndefined();
    expect(
      (contract.impureCircuits as Record<string, unknown>).register_initial_admin,
    ).toBeUndefined();
  });
});

// ─── consumeAdminToken (exercised via mint_capability_tokens) ────────────────

describe("consumeAdminToken — accepts admin color, rejects any other color", () => {
  it("accepts a correctly admin-colored coin and returns 1-unit-less change", () => {
    const { contract, init } = deploy({ adminSupply: 5n });
    const genesisCoin = init.currentZswapLocalState.outputs[0].coinInfo;

    const { outputs } = run(
      contract,
      init.currentContractState.data,
      "mint_capability_tokens",
      genesisCoin,
      seedBytes(1),
      COIN_PK,
      seedBytes(2),
      2n,
    );

    expect(outputs[0].value).toBe(5n); // admin change: 6 - 1
    expect(outputs[1].value).toBe(3n); // new capability coin: 2 + 1
  });

  it("rejects a coin whose color does not equal admin_token_color", () => {
    const { contract, init } = deploy();
    const wrongCoin: SimCoin = { nonce: seedBytes(10), color: seedBytes(11), value: 5n };

    expect(() =>
      run(
        contract,
        init.currentContractState.data,
        "mint_capability_tokens",
        wrongCoin,
        seedBytes(12),
        COIN_PK,
        seedBytes(13),
        1n,
      ),
    ).toThrow("Invalid admin token color");
  });
});

// ─── REQ-04: rotate_admin_tokens ──────────────────────────────────────────────

describe("REQ-04 — rotate_admin_tokens atomic replacement", () => {
  it("S01: burns the old coin and mints new_supply + 1 to the new recipient atomically", () => {
    const { contract, init } = deploy({ adminSupply: 5n });
    const genesisCoin = init.currentZswapLocalState.outputs[0].coinInfo;
    const adminColorHex = toHex(ledgerFn(init.currentContractState.data).admin_token_color);

    const rotated = run(
      contract,
      init.currentContractState.data,
      "rotate_admin_tokens",
      genesisCoin,
      COIN_PK,
      seedBytes(20),
      9n,
    );
    const newAdminCoin = rotated.outputs[0];
    expect(newAdminCoin.value).toBe(10n); // 9 + 1
    expect(toHex(newAdminCoin.color)).toBe(adminColorHex);

    // Exactly one valid admin token afterward: the OLD coin can no longer be spent...
    expect(() =>
      run(contract, rotated.state, "rotate_admin_tokens", genesisCoin, COIN_PK, seedBytes(21), 3n),
    ).toThrow("Admin token already used");

    // ...while the NEW coin remains spendable for further admin-gated operations.
    const afterRotate = run(
      contract,
      rotated.state,
      "mint_capability_tokens",
      newAdminCoin,
      seedBytes(22),
      COIN_PK,
      seedBytes(23),
      1n,
    );
    expect(afterRotate.outputs[0].value).toBe(9n); // 10 - 1 change
  });

  it("S02: reusing an already-nullified coin fails as a whole, with no orphaned or lost admin token", () => {
    const { contract, init } = deploy({ adminSupply: 5n });
    const genesisCoin = init.currentZswapLocalState.outputs[0].coinInfo;

    const first = run(
      contract,
      init.currentContractState.data,
      "rotate_admin_tokens",
      genesisCoin,
      COIN_PK,
      seedBytes(30),
      4n,
    );
    const rotatedCoin = first.outputs[0];
    const stateAfterFirst = first.state;

    // Reusing the already-nullified genesis coin must fail atomically — no
    // partial state, no new mint, the old nullifier stays exactly as marked.
    expect(() =>
      run(
        contract,
        stateAfterFirst,
        "rotate_admin_tokens",
        genesisCoin,
        COIN_PK,
        seedBytes(31),
        9n,
      ),
    ).toThrow("Admin token already used");

    // State integrity: the legitimately-rotated coin (from the first,
    // successful call) remains valid and spendable — at no point does the
    // registry pass through a state with zero valid admin tokens.
    const after = run(
      contract,
      stateAfterFirst,
      "mint_capability_tokens",
      rotatedCoin,
      seedBytes(32),
      COIN_PK,
      seedBytes(33),
      1n,
    );
    expect(after.outputs[0].value).toBe(4n); // rotatedCoin was value 5 (4 + 1) -> change 4
  });
});

// ─── REQ-02/S02 + REQ-03: admin-gated circuits reject a non-admin coin ───────

const ADMIN_GATED_CASES: Array<{ name: string; args: (coin: SimCoin) => unknown[] }> = [
  {
    name: "mint_capability_tokens",
    args: (coin) => [coin, seedBytes(600), COIN_PK, seedBytes(601), 1n],
  },
  {
    name: "issue_did",
    args: (coin) => [coin, seedBytes(602), seedBytes(603), seedBytes(604), seedBytes(605)],
  },
  { name: "grant_role", args: (coin) => [coin, seedBytes(606), seedBytes(607)] },
  { name: "revoke_role", args: (coin) => [coin, seedBytes(608), seedBytes(609)] },
  { name: "revoke_did", args: (coin) => [coin, seedBytes(610)] },
];

describe("REQ-02/S02 — the five admin-gated circuits reject a non-admin-colored coin", () => {
  it.each(ADMIN_GATED_CASES)("$name throws 'Invalid admin token color'", ({ name, args }) => {
    const { contract, init } = deploy();
    const wrongCoin: SimCoin = { nonce: seedBytes(650), color: seedBytes(651), value: 5n };

    expect(() =>
      run(contract, init.currentContractState.data, name, ...args(wrongCoin)),
    ).toThrow("Invalid admin token color");
  });
});

describe("REQ-03 — ISSUER role removed: only admin-token consumption gates issue_did", () => {
  it("issue_did rejects a legitimately-minted capability-colored coin (no ISSUER-role bypass)", () => {
    const { contract, init } = deploy({ adminSupply: 5n });
    const genesisCoin = init.currentZswapLocalState.outputs[0].coinInfo;

    const mintRes = run(
      contract,
      init.currentContractState.data,
      "mint_capability_tokens",
      genesisCoin,
      seedBytes(40),
      COIN_PK,
      seedBytes(41),
      3n,
    );
    const capCoin = mintRes.outputs[1]; // valid, unconsumed capability coin

    // consumeAdminToken(coin) is issue_did's first instruction — it fires
    // before any did_controller/role_by_key lookup, so a legacy ADMIN
    // bookkeeping entry (written read-model-only in the constructor) cannot
    // substitute for actually presenting the admin coin.
    expect(() =>
      run(
        contract,
        mintRes.state,
        "issue_did",
        capCoin,
        seedBytes(42),
        seedBytes(43),
        seedBytes(44),
        seedBytes(45),
      ),
    ).toThrow("Invalid admin token color");
  });
});

// ─── REQ-05: request_update_did enforces the DID-linked token color ─────────

describe("REQ-05 — request_update_did requires the DID's own linked token color", () => {
  it("accepts the DID-linked color and rejects a differently-colored, otherwise-valid coin", () => {
    const { contract, init } = deploy({ adminSupply: 8n });
    let state: rt.StateValue | rt.ChargedState = init.currentContractState.data;
    let adminCoin: SimCoin = init.currentZswapLocalState.outputs[0].coinInfo;

    const mintA = run(contract, state, "mint_capability_tokens", adminCoin, seedBytes(60), COIN_PK, seedBytes(61), 3n);
    state = mintA.state;
    adminCoin = mintA.outputs[0];
    const coinA = mintA.outputs[1];

    const mintB = run(contract, state, "mint_capability_tokens", adminCoin, seedBytes(62), COIN_PK, seedBytes(63), 3n);
    state = mintB.state;
    adminCoin = mintB.outputs[0];
    const coinB = mintB.outputs[1];
    expect(toHex(coinA.color)).not.toBe(toHex(coinB.color));

    const subjectNonce = seedBytes(64);
    const reg = run(contract, state, "gated_self_register_did", coinA, subjectNonce);
    state = reg.state;
    const didKey = reg.result as Uint8Array;
    const coinAChange = reg.outputs[0]; // same color as coinA — the DID-linked color

    const issue = run(contract, state, "issue_did", adminCoin, didKey, seedBytes(65), seedBytes(66), seedBytes(67));
    state = issue.state;
    expect(ledgerFn(state).party_status.lookup(didKey)).toBe(2n); // active

    // Wrong color: coinB is valid (minted, unconsumed) but not linked to this DID.
    expect(() =>
      run(contract, state, "request_update_did", coinB, subjectNonce, seedBytes(68), seedBytes(69)),
    ).toThrow("Token does not match this DID");

    // Correct color: coinAChange carries the DID-linked color.
    const update = run(contract, state, "request_update_did", coinAChange, subjectNonce, seedBytes(70), seedBytes(71));
    expect(ledgerFn(update.state).party_status.lookup(didKey)).toBe(4n); // pending_update
  });
});

// ─── Full admin-gated lifecycle integration (REQ-02, REQ-03, REQ-04, REQ-05) ─

describe("Full lifecycle integration — deploy through rotate_admin_tokens", () => {
  it("deploy -> mint_capability_tokens -> gated_self_register_did -> issue_did -> grant_role -> revoke_role -> revoke_did -> rotate_admin_tokens", () => {
    const { contract, init } = deploy({ adminSupply: 10n });
    let state: rt.StateValue | rt.ChargedState = init.currentContractState.data;
    let adminCoin: SimCoin = init.currentZswapLocalState.outputs[0].coinInfo;
    expect(adminCoin.value).toBe(11n);

    // mint_capability_tokens (admin-gated)
    const mintRes = run(contract, state, "mint_capability_tokens", adminCoin, seedBytes(1), COIN_PK, seedBytes(2), 3n);
    state = mintRes.state;
    adminCoin = mintRes.outputs[0];
    const capCoin = mintRes.outputs[1];
    expect(adminCoin.value).toBe(10n);
    expect(capCoin.value).toBe(4n);

    // gated_self_register_did (capability-token-gated, not admin-gated)
    const regRes = run(contract, state, "gated_self_register_did", capCoin, seedBytes(3));
    state = regRes.state;
    const didKey = regRes.result as Uint8Array;
    expect(didKey).toBeInstanceOf(Uint8Array);
    expect(ledgerFn(state).party_status.lookup(didKey)).toBe(1n); // pending_issuance

    // issue_did (admin-gated — ISSUER role removed)
    const issueRes = run(contract, state, "issue_did", adminCoin, didKey, seedBytes(4), seedBytes(5), seedBytes(6));
    state = issueRes.state;
    adminCoin = issueRes.outputs[0];
    expect(adminCoin.value).toBe(9n);
    expect(ledgerFn(state).party_status.lookup(didKey)).toBe(2n); // active
    expect(ledgerFn(state).total_active_dids).toBe(1n);

    // grant_role (admin-gated)
    const role = seedBytes(7);
    const grantRes = run(contract, state, "grant_role", adminCoin, didKey, role);
    state = grantRes.state;
    adminCoin = grantRes.outputs[0];
    expect(adminCoin.value).toBe(8n);

    // revoke_role (admin-gated)
    const revokeRoleRes = run(contract, state, "revoke_role", adminCoin, didKey, role);
    state = revokeRoleRes.state;
    adminCoin = revokeRoleRes.outputs[0];
    expect(adminCoin.value).toBe(7n);

    // revoke_did (admin-gated)
    const revokeDidRes = run(contract, state, "revoke_did", adminCoin, didKey);
    state = revokeDidRes.state;
    adminCoin = revokeDidRes.outputs[0];
    expect(adminCoin.value).toBe(6n);
    expect(ledgerFn(state).party_status.lookup(didKey)).toBe(3n); // revoked
    expect(ledgerFn(state).total_active_dids).toBe(0n);

    // rotate_admin_tokens (admin-gated, atomic burn + remint)
    const rotateRes = run(contract, state, "rotate_admin_tokens", adminCoin, COIN_PK, seedBytes(8), 6n);
    state = rotateRes.state;
    const finalAdminCoin = rotateRes.outputs[0];
    expect(finalAdminCoin.value).toBe(7n); // 6 + 1
    expect(toHex(finalAdminCoin.color)).toBe(toHex(ledgerFn(state).admin_token_color));
  });
});
