import { describe, it, expect, beforeEach } from 'vitest';
import { TokenStateManager } from '../lib/token/token-state.js';
import type { ShieldedCoin, TokenMintRecord, TokenCapabilityPrivateState } from '../lib/token/token-types.js';
import { TOKEN_STATE_SLOT } from '../lib/token/token-types.js';

// ─── Mock private-state provider ─────────────────────────────────────────────

function makeMockProvider() {
  const store = new Map<string, TokenCapabilityPrivateState>();
  return {
    get(slot: string): TokenCapabilityPrivateState | undefined {
      return store.get(slot);
    },
    set(slot: string, value: TokenCapabilityPrivateState): void {
      store.set(slot, value);
    },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeCoin(value: bigint, tag: string = 'a'): ShieldedCoin {
  const enc = new TextEncoder();
  return {
    nonce: enc.encode(`nonce-${tag}`),
    color: enc.encode(`color-${tag}`),
    value,
    contractAddress: 'contract-0x1234',
  };
}

function makeMintRecord(): TokenMintRecord {
  return {
    subscriptionKey: new Uint8Array(32),
    recipientBytes: new Uint8Array(32),
    contractAddress: 'contract-0x1234',
    mintedAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TokenStateManager', () => {
  let manager: TokenStateManager;

  beforeEach(() => {
    manager = new TokenStateManager(makeMockProvider(), 'contract-0x1234');
  });

  describe('getSpendableCoin()', () => {
    it('returns null when only the anchor coin exists (value === 1n)', () => {
      manager.onCoinMinted(makeCoin(1n, 'anchor'), makeMintRecord());

      const result = manager.getSpendableCoin();
      expect(result).toBeNull();
    });

    it('returns the coin with the highest value when multiple coins exist', () => {
      const low = makeCoin(2n, 'low');
      const high = makeCoin(5n, 'high');
      const anchor = makeCoin(1n, 'anchor');
      manager.onCoinMinted(anchor, makeMintRecord());
      manager.onCoinMinted(low, makeMintRecord());
      manager.onCoinMinted(high, makeMintRecord());

      const result = manager.getSpendableCoin();
      expect(result?.value).toBe(5n);
    });

    it('returns null when no coins exist at all', () => {
      expect(manager.getSpendableCoin()).toBeNull();
    });
  });

  describe('getAnchorCoin()', () => {
    it('returns the coin with value === 1n', () => {
      const anchor = makeCoin(1n, 'anchor');
      manager.onCoinMinted(anchor, makeMintRecord());
      manager.onCoinMinted(makeCoin(3n, 'spendable'), makeMintRecord());

      const result = manager.getAnchorCoin();
      expect(result?.value).toBe(1n);
    });

    it('returns null when no anchor coin exists', () => {
      manager.onCoinMinted(makeCoin(5n, 'big'), makeMintRecord());

      expect(manager.getAnchorCoin()).toBeNull();
    });
  });

  describe('onCoinConsumed()', () => {
    it('removes the spent coin and adds the new coin with value-1', () => {
      const spent = makeCoin(3n, 'spent');
      const received = makeCoin(2n, 'received');

      manager.onCoinMinted(spent, makeMintRecord());
      manager.onCoinConsumed(spent, received);

      const coins = manager.getActiveCoins();
      expect(coins).toHaveLength(1);
      expect(coins[0]?.value).toBe(2n);
    });

    it('leaves other coins untouched when consuming one', () => {
      const anchor = makeCoin(1n, 'anchor');
      const spent = makeCoin(4n, 'spent');
      const received = makeCoin(3n, 'received');

      manager.onCoinMinted(anchor, makeMintRecord());
      manager.onCoinMinted(spent, makeMintRecord());
      manager.onCoinConsumed(spent, received);

      const coins = manager.getActiveCoins();
      expect(coins).toHaveLength(2);
      // Sorted by value desc: received (3n), anchor (1n)
      expect(coins[0]?.value).toBe(3n);
      expect(coins[1]?.value).toBe(1n);
    });
  });

  describe('getActiveCoins()', () => {
    it('returns coins sorted by value descending', () => {
      manager.onCoinMinted(makeCoin(1n, 'a'), makeMintRecord());
      manager.onCoinMinted(makeCoin(10n, 'b'), makeMintRecord());
      manager.onCoinMinted(makeCoin(5n, 'c'), makeMintRecord());

      const coins = manager.getActiveCoins();
      expect(coins.map(c => c.value)).toEqual([10n, 5n, 1n]);
    });
  });

  describe('TOKEN_STATE_SLOT', () => {
    it('is the correct slot key', () => {
      expect(TOKEN_STATE_SLOT).toBe('token-capability-state-v1');
    });
  });
});
