/**
 * Tests for the three new flows:
 *   REQ-10: Admin subscription grant (grantSubscription, renewSubscription)
 *   REQ-11: Orchestrated gated DID actions (executeGatedAction)
 *   REQ-12: Token balance query (getBalance)
 *
 * All tests use in-memory mocks — no devnet or compact-runtime needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  grantSubscription,
  renewSubscription,
  generateSubscriptionKey,
} from '../lib/token/subscription.js';
import {
  executeGatedAction,
  type TokenProviders,
} from '../lib/token/token-witness.js';
import { TokenStateManager } from '../lib/token/token-state.js';
import type { ShieldedCoin, CapabilityProof, SubscriptionRecord } from '../lib/token/token-types.js';
import { padTo32 } from '../lib/token/token-types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytes(seed: number, fill?: number): Uint8Array {
  const b = new Uint8Array(32);
  if (fill !== undefined) return b.fill(fill);
  b[0] = seed & 0xff;
  b[1] = (seed >> 8) & 0xff;
  return b;
}

function makeCoin(opts: Partial<ShieldedCoin> = {}): ShieldedCoin {
  return {
    nonce: bytes(1),
    color: bytes(42),
    value: 5n,
    contractAddress: 'token-addr',
    ...opts,
  };
}

function makeStateManager(): TokenStateManager {
  const store = new Map<string, unknown>();
  return new TokenStateManager(
    { get: (k) => store.get(k) as Parameters<TokenStateManager['onCoinMinted']>[0] | undefined, set: (k, v) => { store.set(k, v); } },
    'token-addr',
  );
}

function makeProviders(opts: {
  stateManager?: TokenStateManager;
  mintResult?: { txHash: string; coinInfo?: { nonce: Uint8Array; color: Uint8Array; value: bigint } };
  consumeResult?: { txHash: string };
  commitmentValue?: Uint8Array;
} = {}): { providers: TokenProviders; mintFn: ReturnType<typeof vi.fn>; consumeFn: ReturnType<typeof vi.fn> } {
  const mintFn = vi.fn().mockResolvedValue(
    opts.mintResult ?? { txHash: 'tx-mint', coinInfo: { nonce: bytes(10), color: bytes(77), value: 6n } }
  );
  const consumeFn = vi.fn().mockResolvedValue(
    opts.consumeResult ?? { txHash: 'tx-consume' }
  );
  const sm = opts.stateManager ?? makeStateManager();
  const providers: TokenProviders = {
    tokenContract: {
      callTx: { mint_capability_tokens: mintFn, consume_token_for_action: consumeFn },
      ledger: {
        capability_commitments: {
          lookup: async () => new Uint8Array(32),
          member: async () => false,
        },
      },
    },
    didRegistryLedger: {
      party_status: { lookup: async () => 2, member: async () => true },
    },
    stateManager: sm,
    generateNonce: () => bytes(99),
    resolveCommitmentValue: async () => opts.commitmentValue ?? bytes(55),
  };
  return { providers, mintFn, consumeFn };
}

// ─── REQ-10: Admin subscription grant ────────────────────────────────────────

describe('grantSubscription (REQ-10)', () => {
  it('mints tokens to recipient with a unique subscriptionKey', async () => {
    const { providers, mintFn } = makeProviders();
    const userId = 'user-123';
    const recipient = { bytes: bytes(88) };

    const result = await grantSubscription(providers, userId, recipient, 5n, 1000);

    expect(mintFn).toHaveBeenCalledWith(
      result.subscriptionKey,
      recipient,
      expect.any(Uint8Array),
      5n,
    );
    expect(result.subscriptionKey).toHaveLength(32);
  });

  it('subscriptionKey encodes userId and timestamp', () => {
    const key1 = generateSubscriptionKey('user-a', 1000);
    const key2 = generateSubscriptionKey('user-b', 1000);
    const key3 = generateSubscriptionKey('user-a', 2000);

    expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key3).toString('hex'));
  });

  it('result.record stores subscriptionKey and creditsGranted', async () => {
    const { providers } = makeProviders();
    const { record } = await grantSubscription(providers, 'user-x', { bytes: bytes(1) }, 10n, 5000);

    expect(record.creditsGranted).toBe(10n);
    expect(record.subscriptionKey).toHaveLength(32);
    expect(record.recipientBytes).toEqual(bytes(1));
    expect(record.grantedAt).toBe(new Date(5000).toISOString());
  });

  it('coin.color comes from circuit output', async () => {
    const expectedColor = bytes(99);
    const { providers } = makeProviders({
      mintResult: { txHash: 'tx', coinInfo: { nonce: bytes(10), color: expectedColor, value: 6n } },
    });
    const { coin } = await grantSubscription(providers, 'user', { bytes: bytes(1) }, 5n);
    expect(coin.color).toEqual(expectedColor);
  });

  it('throws SUBSCRIPTION_INVALID_AMOUNT for creditsToGrant=0', async () => {
    const { providers } = makeProviders();
    await expect(grantSubscription(providers, 'user', { bytes: bytes(1) }, 0n))
      .rejects.toThrow('SUBSCRIPTION_INVALID_AMOUNT');
  });
});

describe('renewSubscription (REQ-10)', () => {
  it('uses the SAME subscriptionKey as the original grant (same color)', async () => {
    const { providers, mintFn } = makeProviders();
    const record: SubscriptionRecord = {
      subscriptionKey: padTo32('original-key'),
      recipientBytes: bytes(88),
      creditsGranted: 5n,
      contractAddress: 'token-addr',
      grantedAt: new Date().toISOString(),
    };

    await renewSubscription(providers, record, 3n);

    // Must use the original subscriptionKey — produces same-colored tokens
    expect(mintFn).toHaveBeenCalledWith(
      record.subscriptionKey,
      { bytes: record.recipientBytes },
      expect.any(Uint8Array),
      3n,
    );
  });

  it('throws SUBSCRIPTION_INVALID_AMOUNT for additionalCredits=0', async () => {
    const { providers } = makeProviders();
    const record: SubscriptionRecord = {
      subscriptionKey: padTo32('key'),
      recipientBytes: bytes(1),
      creditsGranted: 5n,
      contractAddress: '',
      grantedAt: new Date().toISOString(),
    };
    await expect(renewSubscription(providers, record, 0n))
      .rejects.toThrow('SUBSCRIPTION_INVALID_AMOUNT');
  });
});

// ─── REQ-12: Token balance query ──────────────────────────────────────────────

describe('TokenStateManager.getBalance() (REQ-12)', () => {
  let sm: TokenStateManager;

  beforeEach(() => { sm = makeStateManager(); });

  const mintRecord = {
    subscriptionKey: padTo32('key'),
    recipientBytes: bytes(1),
    contractAddress: '',
    mintedAt: new Date().toISOString(),
  };

  it('empty wallet: 0 credits, no anchor, canAct=false', () => {
    const b = sm.getBalance();
    expect(b.spendableCredits).toBe(0n);
    expect(b.hasAnchor).toBe(false);
    expect(b.canAct).toBe(false);
    expect(b.totalCoins).toBe(0);
  });

  it('coin with value=5 → 4 spendable credits', () => {
    sm.onCoinMinted(makeCoin({ value: 5n, nonce: bytes(1) }), mintRecord);
    const b = sm.getBalance();
    expect(b.spendableCredits).toBe(4n); // value - 1 anchor
    expect(b.canAct).toBe(true);
    expect(b.hasAnchor).toBe(false);
  });

  it('anchor coin only (value=1) → 0 credits, hasAnchor=true, canAct=false', () => {
    sm.onCoinMinted(makeCoin({ value: 1n, nonce: bytes(2), color: bytes(42) }), mintRecord);
    const b = sm.getBalance();
    expect(b.spendableCredits).toBe(0n);
    expect(b.hasAnchor).toBe(true);
    expect(b.canAct).toBe(false);
  });

  it('multiple coins sum correctly', () => {
    sm.onCoinMinted(makeCoin({ value: 3n, nonce: bytes(1), color: bytes(42) }), mintRecord);
    sm.onCoinMinted(makeCoin({ value: 5n, nonce: bytes(2), color: bytes(43) }), mintRecord);
    const b = sm.getBalance();
    expect(b.spendableCredits).toBe(6n); // (3-1) + (5-1) = 2 + 4
    expect(b.totalCoins).toBe(2);
  });
});

// ─── onCoinConsumed bug fix — Uint8Array comparison ──────────────────────────

describe('TokenStateManager.onCoinConsumed — Uint8Array comparison (bugfix)', () => {
  it('removes spent coin by value comparison, not reference', () => {
    const sm = makeStateManager();
    const mintRecord = {
      subscriptionKey: padTo32('key'),
      recipientBytes: bytes(1),
      contractAddress: '',
      mintedAt: new Date().toISOString(),
    };
    // Create coin with specific nonce/color byte values
    const coinNonce = new Uint8Array([1, 2, 3, ...new Array(29).fill(0)]);
    const coinColor = new Uint8Array([9, 8, 7, ...new Array(29).fill(0)]);
    const original = makeCoin({ nonce: coinNonce, color: coinColor, value: 5n });
    sm.onCoinMinted(original, mintRecord);

    // Create DIFFERENT Uint8Array instances with same values (different references)
    const spentRef = { ...original, nonce: new Uint8Array(coinNonce), color: new Uint8Array(coinColor) };
    const change = makeCoin({ nonce: bytes(99), color: coinColor, value: 4n });

    sm.onCoinConsumed(spentRef, change);

    const coins = sm.getActiveCoins();
    // Original should be gone; change coin should be present
    expect(coins).toHaveLength(1);
    expect(coins[0].value).toBe(4n);
  });
});

// ─── REQ-11: executeGatedAction — orchestrated flow ──────────────────────────

describe('executeGatedAction (REQ-11)', () => {
  it('selects a spendable coin, consumes it, then calls the action', async () => {
    const sm = makeStateManager();
    const coin = makeCoin({ value: 5n, nonce: bytes(1), color: bytes(42) });
    sm.onCoinMinted(coin, {
      subscriptionKey: padTo32('key'), recipientBytes: bytes(1), contractAddress: '', mintedAt: new Date().toISOString(),
    });

    const { providers, consumeFn } = makeProviders({ stateManager: sm });
    const actionFn = vi.fn().mockResolvedValue({ txHash: 'tx-action' });
    const didKey = bytes(33);

    const { txHash } = await executeGatedAction(providers, 'grant_role', didKey, actionFn);

    expect(consumeFn).toHaveBeenCalledOnce();
    expect(actionFn).toHaveBeenCalledOnce();
    expect(txHash).toBe('tx-action');
  });

  it('throws TOKEN_INSUFFICIENT_CREDITS when no spendable coin', async () => {
    const sm = makeStateManager();
    // Only anchor coin
    sm.onCoinMinted(makeCoin({ value: 1n, nonce: bytes(1), color: bytes(42) }), {
      subscriptionKey: padTo32('key'), recipientBytes: bytes(1), contractAddress: '', mintedAt: new Date().toISOString(),
    });
    const { providers } = makeProviders({ stateManager: sm });

    await expect(
      executeGatedAction(providers, 'revoke_did', bytes(5), vi.fn())
    ).rejects.toThrow('TOKEN_INSUFFICIENT_CREDITS');
  });

  it('reuses a pending proof if TX1 already completed (retry safety)', async () => {
    const sm = makeStateManager();
    const didKey = bytes(33);
    const existingProof: CapabilityProof = {
      nullifier: bytes(10),
      commitmentValue: bytes(55),
      actionType: 'revoke_did',
      didKey,
      tokenContractAddress: '',
      coinColor: bytes(42),
    };
    sm.savePendingProof(existingProof);

    const { providers, consumeFn } = makeProviders({ stateManager: sm });
    const actionFn = vi.fn().mockResolvedValue({ txHash: 'tx-retry' });

    const { proof, txHash } = await executeGatedAction(providers, 'revoke_did', didKey, actionFn);

    // TX1 must NOT have been called again
    expect(consumeFn).not.toHaveBeenCalled();
    expect(actionFn).toHaveBeenCalledWith(existingProof);
    expect(txHash).toBe('tx-retry');
    expect(proof.nullifier).toEqual(bytes(10));
  });

  it('proof passed to action includes coinColor', async () => {
    const sm = makeStateManager();
    const coinColor = bytes(77);
    const coin = makeCoin({ value: 3n, nonce: bytes(1), color: coinColor });
    sm.onCoinMinted(coin, {
      subscriptionKey: padTo32('key'), recipientBytes: bytes(1), contractAddress: '', mintedAt: new Date().toISOString(),
    });

    const { providers } = makeProviders({ stateManager: sm });
    let capturedProof: CapabilityProof | undefined;
    const actionFn = vi.fn().mockImplementation(async (p: CapabilityProof) => {
      capturedProof = p;
      return { txHash: 'tx' };
    });

    await executeGatedAction(providers, 'self_register_did', bytes(5), actionFn);

    expect(capturedProof?.coinColor).toEqual(coinColor);
  });

  it('pending proof is cleared after successful TX2', async () => {
    const sm = makeStateManager();
    const coin = makeCoin({ value: 5n, nonce: bytes(1), color: bytes(42) });
    sm.onCoinMinted(coin, {
      subscriptionKey: padTo32('key'), recipientBytes: bytes(1), contractAddress: '', mintedAt: new Date().toISOString(),
    });
    const didKey = bytes(33);
    const { providers } = makeProviders({ stateManager: sm });

    await executeGatedAction(providers, 'grant_role', didKey, vi.fn().mockResolvedValue({ txHash: 'tx' }));

    // Should be cleared — a second call should re-consume (not reuse)
    const pending = sm.getPendingProof('grant_role', Buffer.from(didKey).toString('hex'));
    expect(pending).toBeUndefined();
  });
});
