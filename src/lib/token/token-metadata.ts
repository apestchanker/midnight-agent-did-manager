export type TokenBalanceKind = "didmn_action_credit" | "unknown";

export interface ClassifiedTokenBalance {
  color: string;
  rawBalance: bigint;
  kind: TokenBalanceKind;
  verified: boolean;
  spendableCredits: bigint;
  isAnchorOnly: boolean;
}

export function classifyTokenBalance(
  color: string,
  rawBalance: bigint,
  activeTokenColor?: string | null,
  verifiedTokenColors: ReadonlySet<string> = new Set(),
): ClassifiedTokenBalance {
  const normalizedColor = color.trim().toLowerCase();
  const normalizedActiveColor = activeTokenColor?.trim().toLowerCase() || "";
  const verified =
    verifiedTokenColors.has(normalizedColor) ||
    (!!normalizedActiveColor && normalizedColor === normalizedActiveColor);
  const spendableCredits = rawBalance > 1n ? rawBalance - 1n : 0n;

  return {
    color,
    rawBalance,
    kind: verified ? "didmn_action_credit" : "unknown",
    verified,
    spendableCredits,
    isAnchorOnly: rawBalance === 1n,
  };
}
