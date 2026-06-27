import type {
  ShieldedCoin,
  TokenMintRecord,
  TokenCapabilityPrivateState,
  TokenBalance,
  CapabilityProof,
} from './token-types.js';
import { TOKEN_STATE_SLOT } from './token-types.js';

type PrivateStateProvider = {
  get(slot: string): TokenCapabilityPrivateState | undefined;
  set(slot: string, value: TokenCapabilityPrivateState): void;
};

export class TokenStateManager {
  constructor(
    private readonly provider: PrivateStateProvider,
    readonly contractAddress: string
  ) {}

  private getState(): TokenCapabilityPrivateState {
    return this.provider.get(TOKEN_STATE_SLOT) ?? {
      coins: [],
      mintRecords: [],
      pendingProofs: [],
    };
  }

  private setState(state: TokenCapabilityPrivateState): void {
    this.provider.set(TOKEN_STATE_SLOT, state);
  }

  getActiveCoins(): ShieldedCoin[] {
    return [...this.getState().coins].sort((a, b) =>
      a.value > b.value ? -1 : a.value < b.value ? 1 : 0
    );
  }

  getSpendableCoin(): ShieldedCoin | null {
    const spendable = this.getActiveCoins().filter(c => c.value > 1n);
    return spendable[0] ?? null;
  }

  getAnchorCoin(): ShieldedCoin | null {
    return this.getActiveCoins().find(c => c.value === 1n) ?? null;
  }

  onCoinMinted(coin: ShieldedCoin, mintRecord: TokenMintRecord): void {
    const state = this.getState();
    this.setState({
      ...state,
      coins: [...state.coins, coin],
      mintRecords: [...state.mintRecords, mintRecord],
    });
  }

  onCoinConsumed(spent: ShieldedCoin, received: ShieldedCoin): void {
    const state = this.getState();
    // Uint8Array equality requires buffer comparison, not reference equality
    const spentNonceHex = Buffer.from(spent.nonce).toString('hex');
    const spentColorHex = Buffer.from(spent.color).toString('hex');
    const coins = state.coins.filter(
      c =>
        Buffer.from(c.nonce).toString('hex') !== spentNonceHex ||
        Buffer.from(c.color).toString('hex') !== spentColorHex
    );
    this.setState({
      ...state,
      coins: [...coins, received],
    });
  }

  getBalance(): TokenBalance {
    const coins = this.getActiveCoins();
    const spendable = coins.filter(c => c.value > 1n);
    const spendableCredits = spendable.reduce((sum, c) => sum + (c.value - 1n), 0n);
    return {
      spendableCredits,
      hasAnchor: coins.some(c => c.value === 1n),
      canAct: spendableCredits > 0n,
      totalCoins: coins.length,
    };
  }

  clearPendingProof(actionType: string, didKeyHex: string): void {
    const state = this.getState();
    this.setState({
      ...state,
      pendingProofs: state.pendingProofs.filter(
        p => !(p.actionType === actionType && Buffer.from(p.didKey).toString('hex') === didKeyHex)
      ),
    });
  }

  getPendingProof(actionType: string, didKeyHex: string): CapabilityProof | undefined {
    return this.getState().pendingProofs.find(
      p => p.actionType === actionType && Buffer.from(p.didKey).toString('hex') === didKeyHex
    );
  }

  savePendingProof(proof: CapabilityProof): void {
    const state = this.getState();
    this.setState({
      ...state,
      pendingProofs: [...state.pendingProofs, proof],
    });
  }

}
