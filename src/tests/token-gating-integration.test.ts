/**
 * Integration tests for the full capability-token-gating flow:
 * token_gating.compact → did_registry.compact (two-circuit coordination).
 *
 * ## Test strategy
 *
 * All tests run locally via @midnight-ntwrk/compact-runtime — no devnet, no ZK compilation.
 *
 * Key technique: `persistentHash` is exported directly from compact-runtime,
 * so we can pre-compute `did_key` in TypeScript before building the capability
 * proof. This allows us to build valid proofs for `self_register_did`, which
 * derives `did_key` internally using the same hash.
 *
 * Two-contract coordination model (important):
 * - There is NO on-chain cross-contract call. Both contracts share cryptographic
 *   VALUES (nullifier + commitment) computed off-chain.
 * - TX1: consume_token_for_action writes {nullifier → commitment} to token_gating ledger.
 * - TX2: self_register_did reads the supplied (nullifier, commitment) and verifies
 *   commitment == persistentHash([action_type, token_contract.bytes, did_key]).
 * - The did_registry's token_contract_address MUST equal the address used as
 *   kernel.self() inside consume_token_for_action for the math to match.
 *   In tests both use dummyContractAddress() = all-zeros → they always agree.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract as TokenContract, ledger as tokenLedger } from '../generated/token-gating/contract/index.js';
import { Contract as DidContract, ledger as didLedger } from '../generated/did-registry/contract/index.js';
import { TokenStateManager } from '../lib/token/token-state.js';
import type { ShieldedCoin, TokenMintRecord, TokenCapabilityPrivateState } from '../lib/token/token-types.js';
import { TOKEN_STATE_SLOT } from '../lib/token/token-types.js';

// ─── Shared runtime helpers ───────────────────────────────────────────────────

const COIN_PK = { bytes: new Uint8Array(Buffer.from(rt.dummyUserAddress(), 'hex')) };
const TOKEN_CONTRACT_BYTES = rt.encodeContractAddress(rt.dummyContractAddress());
const TOKEN_CONTRACT_KEY = { bytes: TOKEN_CONTRACT_BYTES };

// Type descriptors for persistentHash
const bytes32T = new rt.CompactTypeBytes(32);
const vec4T = new rt.CompactTypeVector(4, bytes32T);
const vec5T = new rt.CompactTypeVector(5, bytes32T);

function nonce(seed: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = seed & 0xff;
  b[1] = (seed >> 8) & 0xff;
  return b;
}

function pad32(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(32);
  out.set(enc.subarray(0, 32));
  return out;
}

/**
 * Compute the did_key that `self_register_did` derives internally for given inputs.
 * Mirrors Compact: persistentHash<Vector<4,Bytes<32>>>([pad32("didmn:did:v1"), registry_salt, controller.bytes, subject_nonce])
 */
function computeDidKey(registrySalt: Uint8Array, controllerBytes: Uint8Array, subjectNonce: Uint8Array): Uint8Array {
  return rt.persistentHash(vec4T, [pad32('didmn:did:v1'), registrySalt, controllerBytes, subjectNonce]);
}

/**
 * Compute the nullifier_proxy from a raw coin nonce.
 * Mirrors Compact: persistentHash<Bytes<32>>(nonce)
 */
function computeNullifierProxy(coinNonce: Uint8Array): Uint8Array {
  return rt.persistentHash(bytes32T, coinNonce);
}

/**
 * Compute the expected commitment for assertCapabilityProof.
 * Mirrors Compact: persistentHash<Vector<5,Bytes<32>>>([action_type, token_contract.bytes, did_key, color, nullifier_proxy])
 * The nullifier_proxy ties the commitment to the specific token-spend event (anti-replay).
 */
function computeCommitment(actionType: Uint8Array, tokenContractBytes: Uint8Array, didKey: Uint8Array, color: Uint8Array, coinNonce: Uint8Array): Uint8Array {
  const nullifierProxy = computeNullifierProxy(coinNonce);
  return rt.persistentHash(vec5T, [actionType, tokenContractBytes, didKey, color, nullifierProxy]);
}

// ─── Contract setup helpers ───────────────────────────────────────────────────

const REGISTRY_SALT = nonce(42);

let tokenContract: TokenContract;
let didContract: DidContract;
let tokenInitState: rt.ChargedState | rt.StateValue;
let didInitState: rt.ChargedState | rt.StateValue;
let postAdminState: rt.ChargedState | rt.StateValue;

beforeAll(() => {
  tokenContract = new TokenContract({});
  const tokenCtorCtx = rt.createConstructorContext({}, COIN_PK);
  tokenInitState = tokenContract.initialState(tokenCtorCtx).currentContractState.data;

  didContract = new DidContract({});
  const didCtorCtx = rt.createConstructorContext({}, COIN_PK);
  didInitState = didContract.initialState(didCtorCtx, REGISTRY_SALT, TOKEN_CONTRACT_KEY).currentContractState.data;

  // Register admin (one-time setup, no proof needed)
  const adminCtx = rt.createCircuitContext(rt.dummyContractAddress(), rt.emptyZswapLocalState(COIN_PK), didInitState, {});
  const adminResult = didContract.impureCircuits.register_initial_admin(adminCtx);
  postAdminState = adminResult.context.currentQueryContext.state;
});

function makeTokenCtx(state: rt.ChargedState | rt.StateValue = tokenInitState): rt.CircuitContext<object> {
  return rt.createCircuitContext(rt.dummyContractAddress(), rt.emptyZswapLocalState(COIN_PK), state, {});
}

function makeDidCtx(state: rt.ChargedState | rt.StateValue = postAdminState): rt.CircuitContext<object> {
  return rt.createCircuitContext(rt.dummyContractAddress(), rt.emptyZswapLocalState(COIN_PK), state, {});
}

/**
 * Mint tokens and return the minted coin + post-mint state.
 */
function mintTokens(amount: bigint, _didKey: Uint8Array, coinNonce: Uint8Array, baseState?: rt.ChargedState | rt.StateValue) {
  const ctx = makeTokenCtx(baseState);
  // subscription_key derives the color; recipient is the user's shielded address.
  const result = tokenContract.impureCircuits.mint_capability_tokens(ctx, nonce(99), COIN_PK, coinNonce, amount);
  const mintedCoin = result.context.currentZswapLocalState.outputs[0].coinInfo as { nonce: Uint8Array; color: Uint8Array; value: bigint };
  const mt_index = result.context.currentZswapLocalState.currentIndex - 1n;
  return { result, mintedCoin: { ...mintedCoin, mt_index }, postMintState: result.context.currentQueryContext.state };
}

/**
 * Consume a token and extract the nullifier+commitment written to the token_gating ledger.
 */
function consumeToken(coin: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint }, actionType: Uint8Array, didKey: Uint8Array, baseState?: rt.ChargedState | rt.StateValue) {
  const ctx = makeTokenCtx(baseState);
  const result = tokenContract.impureCircuits.consume_token_for_action(ctx, coin, actionType, didKey);
  const postConsumeState = result.context.currentQueryContext.state as rt.ChargedState;
  const tLedger = tokenLedger(postConsumeState);
  const entries = [...tLedger.capability_commitments];
  const [nullifier, commitment] = entries[entries.length - 1]; // last entry
  return { result, nullifier, commitment, postConsumeState };
}

// ─── Pure TS helper tests ─────────────────────────────────────────────────────

describe('cross-contract crypto math — pure TS', () => {
  it('computeDidKey is deterministic for given salt + nonce', () => {
    const k1 = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, nonce(10));
    const k2 = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, nonce(10));
    expect(Buffer.from(k1).toString('hex')).toBe(Buffer.from(k2).toString('hex'));
  });

  it('computeDidKey differs with different subject_nonce', () => {
    const k1 = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, nonce(10));
    const k2 = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, nonce(11));
    expect(Buffer.from(k1).toString('hex')).not.toBe(Buffer.from(k2).toString('hex'));
  });

  it('computeCommitment is deterministic', () => {
    const didKey = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, nonce(10));
    const color = nonce(5);
    const coinNonce = nonce(99);
    const c1 = computeCommitment(pad32('self_register_did'), TOKEN_CONTRACT_BYTES, didKey, color, coinNonce);
    const c2 = computeCommitment(pad32('self_register_did'), TOKEN_CONTRACT_BYTES, didKey, color, coinNonce);
    expect(Buffer.from(c1).toString('hex')).toBe(Buffer.from(c2).toString('hex'));
  });
});

// ─── Full two-TX flow ─────────────────────────────────────────────────────────

describe('REQ-04: full two-TX flow (mint → consume → self_register_did)', () => {
  it('TX1+TX2: consume produces valid proof; self_register_did accepts it and registers DID', () => {
    // --- PRE-COMPUTE did_key (what the circuit will derive internally) ---
    const subjectNonce = nonce(50);
    const did_key = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, subjectNonce);

    // --- TX1: MINT then CONSUME capability token ---
    const { mintedCoin, postMintState } = mintTokens(3n, did_key, nonce(60));
    const actionType = pad32('self_register_did');
    const { commitment } = consumeToken(mintedCoin, actionType, did_key, postMintState);

    // The commitment must match our pre-computation (now includes color + nullifier_proxy)
    const expectedCommitment = computeCommitment(actionType, TOKEN_CONTRACT_BYTES, did_key, mintedCoin.color, mintedCoin.nonce);
    expect(Buffer.from(commitment).toString('hex')).toBe(Buffer.from(expectedCommitment).toString('hex'));

    // --- TX2: self_register_did with the proof from TX1 (token_color = minted coin's color) ---
    // Pass raw coin nonce — the circuit derives nullifier_proxy = persistentHash(nonce) internally.
    const ctx = makeDidCtx();
    const result = didContract.impureCircuits.self_register_did(ctx, subjectNonce, mintedCoin.color, mintedCoin.nonce, commitment);

    // Circuit returns the computed did_key
    const returnedKey = result.result as Uint8Array;
    expect(Buffer.from(returnedKey).toString('hex')).toBe(Buffer.from(did_key).toString('hex'));

    // DID is now registered (party_status = 1 = pending)
    const postRegState = result.context.currentQueryContext.state;
    const l = didLedger(postRegState);
    expect(l.did_controller.member(did_key)).toBe(true);
    expect(l.party_status.lookup(did_key)).toBe(1n); // pending issuance (Compact Uint<8> comes back as bigint)

    // used_capability_nullifiers stores the raw nonce (the circuit hashes it to get nullifier_proxy)
    expect(l.used_capability_nullifiers.member(mintedCoin.nonce)).toBe(true);
  });

  it('TX1+TX2: mint amount=5 produces coin with value=6; after consume, change coin has value=5', () => {
    const subjectNonce = nonce(51);
    const did_key = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, subjectNonce);

    const { mintedCoin, postMintState } = mintTokens(5n, did_key, nonce(61));
    expect(mintedCoin.value).toBe(6n); // amount + 1 anchor

    const actionType = pad32('self_register_did');
    const { result: consumeResult, commitment } = consumeToken(mintedCoin, actionType, did_key, postMintState);

    // Change coin value = 6 - 1 = 5
    const changeOutputs = consumeResult.context.currentZswapLocalState.outputs;
    expect(changeOutputs[0].coinInfo.value).toBe(5n);

    // TX2 works with this proof (raw coin nonce)
    const ctx = makeDidCtx();
    expect(() => didContract.impureCircuits.self_register_did(ctx, subjectNonce, mintedCoin.color, mintedCoin.nonce, commitment)).not.toThrow();
  });
});

// ─── Anti-replay ─────────────────────────────────────────────────────────────

describe('REQ-06: anti-replay — same nullifier rejected on second use', () => {
  it('TX2 succeeds, TX3 with same proof fails with "Capability already used"', () => {
    // --- Build proof ---
    const subjectNonce = nonce(70);
    const did_key = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, subjectNonce);
    const { mintedCoin, postMintState } = mintTokens(3n, did_key, nonce(80));
    const actionType = pad32('self_register_did');
    const { commitment } = consumeToken(mintedCoin, actionType, did_key, postMintState);

    // --- TX2: first use of the proof — must succeed ---
    const ctx1 = makeDidCtx();
    const tx2Result = didContract.impureCircuits.self_register_did(ctx1, subjectNonce, mintedCoin.color, mintedCoin.nonce, commitment);
    const postTx2State = tx2Result.context.currentQueryContext.state;

    // Raw nonce is now marked as used in used_capability_nullifiers
    expect(didLedger(postTx2State).used_capability_nullifiers.member(mintedCoin.nonce)).toBe(true);

    // --- TX3: reuse same nonce — must fail with "Capability already used" ---
    const ctx2 = makeDidCtx(postTx2State);
    expect(() =>
      didContract.impureCircuits.self_register_did(ctx2, subjectNonce, mintedCoin.color, mintedCoin.nonce, commitment)
    ).toThrow('Capability already used');
  });

  it('two different proofs (different nullifiers) are both accepted independently', () => {
    // Proof A for subjectNonce=72
    const subjectNonceA = nonce(72);
    const did_key_A = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, subjectNonceA);
    const { mintedCoin: coinA, postMintState: mintStateA } = mintTokens(2n, did_key_A, nonce(90));
    const actionTypeA = pad32('self_register_did');
    const { commitment: commitA } = consumeToken(coinA, actionTypeA, did_key_A, mintStateA);

    // Proof B for subjectNonce=73
    const subjectNonceB = nonce(73);
    const did_key_B = computeDidKey(REGISTRY_SALT, COIN_PK.bytes, subjectNonceB);
    const { mintedCoin: coinB, postMintState: mintStateB } = mintTokens(2n, did_key_B, nonce(91));
    const actionTypeB = pad32('self_register_did');
    const { commitment: commitB } = consumeToken(coinB, actionTypeB, did_key_B, mintStateB);

    // Use proof A (raw coin nonce)
    const ctx1 = makeDidCtx();
    const result1 = didContract.impureCircuits.self_register_did(ctx1, subjectNonceA, coinA.color, coinA.nonce, commitA);
    const stateAfterA = result1.context.currentQueryContext.state;

    // Use proof B in the state after A (raw coin nonce)
    const ctx2 = makeDidCtx(stateAfterA);
    const result2 = didContract.impureCircuits.self_register_did(ctx2, subjectNonceB, coinB.color, coinB.nonce, commitB);
    const stateAfterB = result2.context.currentQueryContext.state;

    // Both DIDs registered
    const l = didLedger(stateAfterB);
    expect(l.did_controller.member(did_key_A)).toBe(true);
    expect(l.did_controller.member(did_key_B)).toBe(true);
  });
});

// ─── TokenStateManager — pure TS ─────────────────────────────────────────────

describe('TokenStateManager — pure TS', () => {
  function makeMockProvider() {
    const store = new Map<string, TokenCapabilityPrivateState>();
    return { get: (k: string) => store.get(k), set: (k: string, v: TokenCapabilityPrivateState) => store.set(k, v) };
  }

  function makeCoin(value: bigint, tag: string = 'a'): ShieldedCoin {
    const enc = new TextEncoder();
    return { nonce: enc.encode(`nonce-${tag}`), color: enc.encode(`color-${tag}`), value, contractAddress: 'contract-0xtoken' };
  }

  function makeMintRecord(): TokenMintRecord {
    return { subscriptionKey: new Uint8Array(32), recipientBytes: new Uint8Array(32), contractAddress: 'contract-0xtoken', mintedAt: new Date().toISOString() };
  }

  it('mint adds UTXO with value = amount + 1 (anchor included)', () => {
    const m = new TokenStateManager(makeMockProvider(), 'contract-0xtoken');
    m.onCoinMinted(makeCoin(6n, 'a'), makeMintRecord());
    expect(m.getActiveCoins()[0]?.value).toBe(6n);
  });

  it('anchor protection: coin with value === 1n is never returned as spendable', () => {
    const m = new TokenStateManager(makeMockProvider(), 'contract-0xtoken');
    m.onCoinMinted(makeCoin(1n, 'anchor'), makeMintRecord());
    expect(m.getSpendableCoin()).toBeNull();
    expect(m.getAnchorCoin()?.value).toBe(1n);
  });

  it('anchor protection survives a full consume cycle (value 4 → 3 → 2 → 1 = anchor)', () => {
    const m = new TokenStateManager(makeMockProvider(), 'contract-0xtoken');
    const initial = makeCoin(4n, 'initial');
    m.onCoinMinted(initial, makeMintRecord());
    let current = initial; // same reference — TokenStateManager uses object identity to find the coin
    for (let v = 3n; v >= 1n; v--) {
      const next = makeCoin(v, `step-${v}`);
      m.onCoinConsumed(current, next);
      current = next;
    }
    expect(m.getSpendableCoin()).toBeNull();
    expect(m.getAnchorCoin()?.value).toBe(1n);
  });

  it('TOKEN_STATE_SLOT constant is stable', () => {
    expect(TOKEN_STATE_SLOT).toBe('token-capability-state-v1');
  });
});
