/**
 * Unit tests for the token_gating.compact contract circuits.
 *
 * All tests run locally via @midnight-ntwrk/compact-runtime — no devnet needed.
 *
 * Key API notes discovered during implementation:
 * - impureCircuits return { result, context, proofData, gasCost }
 *   The circuit internally does `context = { ...contextOrig }` (shallow copy),
 *   so mutations (ZswapLocalState updates) are on result.context, NOT the input ctx.
 * - Raw outputs are in result.context.currentZswapLocalState.outputs[].coinInfo
 *   (Uint8Array nonce/color, bigint value). Use these directly — decodeZswapLocalState
 *   re-encodes nonce/color as hex strings which the circuit rejects.
 * - Contract state after a circuit call is in result.context.currentQueryContext.state
 *   (a ChargedState). Pass this to createCircuitContext for the next call.
 * - CoinPublicKey must be { bytes: Uint8Array<32> }, not a plain Uint8Array.
 *   Use sampleCoinPublicKey() + encodeCoinPublicKey() from @midnight-ntwrk/ledger-v8
 *   and wrap as { bytes: encodedKey }.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../generated/token-gating/contract/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad32(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(32);
  out.set(enc.subarray(0, 32));
  return out;
}

function nonce(seed: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = seed & 0xff;
  b[1] = (seed >> 8) & 0xff;
  return b;
}

// ─── Contract setup ──────────────────────────────────────────────────────────

let contract: Contract;
let COIN_PK: { bytes: Uint8Array };
let init: rt.ConstructorResult<object>;

beforeAll(() => {
  // CoinPublicKey must be { bytes: Uint8Array<32> } — plain Uint8Array causes ownPublicKey() to fail.
  // We use dummyUserAddress() (no WASM from ledger-v8 needed) converted to a fixed 32-byte key.
  COIN_PK = { bytes: new Uint8Array(Buffer.from(rt.dummyUserAddress(), 'hex')) };

  contract = new Contract({});
  const ctorCtx = rt.createConstructorContext({}, COIN_PK);
  init = contract.initialState(ctorCtx);
});

/** Fresh circuit context rooted at the given contract state. */
function makeCtx(state: rt.ChargedState | rt.StateValue = init.currentContractState.data): rt.CircuitContext<object> {
  return rt.createCircuitContext(
    rt.dummyContractAddress(),
    rt.emptyZswapLocalState(COIN_PK),
    state,
    {},
  );
}

/** Run mint_capability_tokens and return the result. */
function mint(
  amount: bigint,
  opts: { subscriptionKey?: Uint8Array; recipient?: { bytes: Uint8Array }; coinNonce?: Uint8Array; baseState?: rt.ChargedState | rt.StateValue } = {},
) {
  const ctx = makeCtx(opts.baseState);
  const result = contract.impureCircuits.mint_capability_tokens(
    ctx,
    opts.subscriptionKey ?? nonce(2),
    opts.recipient ?? COIN_PK,
    opts.coinNonce ?? nonce(3),
    amount,
  );
  const mintedCoin = result.context.currentZswapLocalState.outputs[0]?.coinInfo as {
    nonce: Uint8Array;
    color: Uint8Array;
    value: bigint;
  };
  const mt_index = result.context.currentZswapLocalState.currentIndex - 1n;
  return { result, mintedCoin, mt_index };
}

/** Run consume_token_for_action and return the result. */
function consume(
  coin: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint },
  opts: { actionType?: Uint8Array; didKey?: Uint8Array; baseState?: rt.ChargedState | rt.StateValue } = {},
) {
  const state = opts.baseState;
  const ctx = makeCtx(state);
  return contract.impureCircuits.consume_token_for_action(
    ctx,
    coin,
    opts.actionType ?? pad32('self_register_did'),
    opts.didKey ?? nonce(5),
  );
}

// ─── Initial ledger state ────────────────────────────────────────────────────

describe('token_gating.compact — initial ledger state', () => {
  it('capability_commitments starts empty after deployment', () => {
    const l = ledger(init.currentContractState.data);
    expect(l.capability_commitments.isEmpty()).toBe(true);
  });

  it('capability_commitments.member returns false for unknown key', () => {
    const l = ledger(init.currentContractState.data);
    expect(l.capability_commitments.member(nonce(99))).toBe(false);
  });
});

// ─── mint_capability_tokens ───────────────────────────────────────────────────

describe('token_gating.compact — mint_capability_tokens', () => {
  it('REQ-01/S03 — rejects amount=0 with "Amount must be >= 1"', () => {
    expect(() => mint(0n)).toThrow('Amount must be >= 1');
  });

  it('REQ-01/S01 — mint produces UTXO with value = amount + 1', () => {
    const { mintedCoin } = mint(5n);
    expect(mintedCoin).toBeDefined();
    expect(mintedCoin.value).toBe(6n); // 5 credits + 1 anchor
  });

  it('REQ-01/S01 — mint with amount=1 produces value=2 (1 credit + anchor)', () => {
    const { mintedCoin } = mint(1n);
    expect(mintedCoin.value).toBe(2n);
  });

  it('REQ-05/S01 — two mints with distinct subscription_key produce distinct token colors', () => {
    const { mintedCoin: coin1 } = mint(3n, { subscriptionKey: nonce(1), coinNonce: nonce(10) });
    const { mintedCoin: coin2 } = mint(3n, { subscriptionKey: nonce(2), coinNonce: nonce(11) });
    expect(coin1.color).toBeDefined();
    expect(coin2.color).toBeDefined();
    // Colors must differ because domain_sep is derived from subscription_key
    expect(Buffer.from(coin1.color).toString('hex')).not.toBe(Buffer.from(coin2.color).toString('hex'));
  });

  it('REQ-05/S02 — same subscription_key produces the same color deterministically', () => {
    const { mintedCoin: coin1 } = mint(2n, { subscriptionKey: nonce(7), coinNonce: nonce(10) });
    const { mintedCoin: coin2 } = mint(2n, { subscriptionKey: nonce(7), coinNonce: nonce(11) });
    expect(Buffer.from(coin1.color).toString('hex')).toBe(Buffer.from(coin2.color).toString('hex'));
  });
});

// ─── consume_token_for_action ─────────────────────────────────────────────────

describe('token_gating.compact — consume_token_for_action', () => {
  it('REQ-02/S02 — rejects anchor coin (value=1) with "Anchor token: cannot spend last unit"', () => {
    // No need for a real mint — the assert fires before any Zswap ops
    const anchorCoin = { nonce: nonce(42), color: nonce(99), value: 1n, mt_index: 0n };
    expect(() => consume(anchorCoin)).toThrow('Anchor token: cannot spend last unit');
  });

  it('REQ-02/S01 — consume (value=4) produces change UTXO with value=3', () => {
    const { mintedCoin, mt_index, result: mintResult } = mint(3n);
    const postMintState = mintResult.context.currentQueryContext.state;
    const qualifiedCoin = { ...mintedCoin, mt_index };

    const consumeResult = consume(qualifiedCoin, { baseState: postMintState });
    const changeOutputs = consumeResult.context.currentZswapLocalState.outputs;

    expect(changeOutputs).toHaveLength(1);
    expect(changeOutputs[0].coinInfo.value).toBe(3n); // 4 - 1
    expect(consumeResult.context.currentZswapLocalState.inputs).toHaveLength(1);
  });

  it('REQ-02/S04 — consume value=2 produces anchor (value=1)', () => {
    const { mintedCoin, mt_index, result: mintResult } = mint(1n); // amount=1 → value=2
    const postMintState = mintResult.context.currentQueryContext.state;
    const qualifiedCoin = { ...mintedCoin, mt_index };

    const consumeResult = consume(qualifiedCoin, { baseState: postMintState });
    const changeOutputs = consumeResult.context.currentZswapLocalState.outputs;

    expect(changeOutputs[0].coinInfo.value).toBe(1n); // anchor
  });

  it('REQ-03/S01 — consume writes commitment to capability_commitments', () => {
    const { mintedCoin, mt_index, result: mintResult } = mint(3n);
    const postMintState = mintResult.context.currentQueryContext.state;
    const qualifiedCoin = { ...mintedCoin, mt_index };

    const consumeResult = consume(qualifiedCoin, { baseState: postMintState });
    const postConsumeState = consumeResult.context.currentQueryContext.state;

    const l = ledger(postConsumeState);
    expect(l.capability_commitments.size()).toBe(1n);
    expect(l.capability_commitments.isEmpty()).toBe(false);
  });

  it('REQ-07/S01 — anchor survives when all credits consumed (value=2 → consume → value=1 → blocked)', () => {
    // Mint 1 credit (value=2 = 1 credit + anchor)
    const { mintedCoin, mt_index, result: mintResult } = mint(1n);
    const postMintState = mintResult.context.currentQueryContext.state;
    const qualifiedCoin = { ...mintedCoin, mt_index };

    // Consume 1 credit → change coin with value=1 (anchor)
    const consumeResult = consume(qualifiedCoin, { baseState: postMintState });
    const changeOutputs = consumeResult.context.currentZswapLocalState.outputs;
    const anchorCoin = { ...changeOutputs[0].coinInfo, mt_index: 1n };

    expect(anchorCoin.value).toBe(1n);

    // Try to consume the anchor → must fail
    const postConsumeState = consumeResult.context.currentQueryContext.state;
    expect(() => consume(anchorCoin, { baseState: postConsumeState }))
      .toThrow('Anchor token: cannot spend last unit');
  });
});

// ─── Pure TS helpers ─────────────────────────────────────────────────────────

describe('token-gating test helpers — pure TS', () => {
  it('pad32 produces 32 bytes with correct UTF-8 prefix', () => {
    const result = pad32('self_register_did');
    expect(result).toHaveLength(32);
    expect(result[0]).toBe('s'.charCodeAt(0));
    expect(result[16]).toBe('d'.charCodeAt(0));
    expect(result[17]).toBe(0);
  });

  it('nonce helper produces distinct values for distinct seeds', () => {
    expect(nonce(1)[0]).not.toBe(nonce(2)[0]);
  });
});
