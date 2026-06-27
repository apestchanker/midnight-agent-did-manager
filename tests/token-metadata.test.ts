import { describe, expect, it } from "vitest";
import { classifyTokenBalance } from "../src/lib/token/token-metadata";

describe("token metadata classification", () => {
  it("marks the active token-gating color as a verified didMN action credit", () => {
    const balance = classifyTokenBalance("57c84e", 6n, "57C84E");

    expect(balance).toMatchObject({
      kind: "didmn_action_credit",
      verified: true,
      rawBalance: 6n,
      spendableCredits: 5n,
      isAnchorOnly: false,
    });
  });

  it("marks a contract-valid color as verified even when it is not the contract address", () => {
    const verifiedColors = new Set(["abc123"]);
    const balance = classifyTokenBalance("ABC123", 6n, "57c84e", verifiedColors);

    expect(balance.kind).toBe("didmn_action_credit");
    expect(balance.verified).toBe(true);
  });

  it("keeps non-active wallet balances unknown and unverified", () => {
    const balance = classifyTokenBalance("abc123", 9n, "57c84e");

    expect(balance).toMatchObject({
      kind: "unknown",
      verified: false,
      spendableCredits: 8n,
    });
  });

  it("treats one raw unit as the permanent anchor with no spendable credits", () => {
    const balance = classifyTokenBalance("57c84e", 1n, "57c84e");

    expect(balance.spendableCredits).toBe(0n);
    expect(balance.isAnchorOnly).toBe(true);
  });

  it("does not verify balances when there is no active token contract", () => {
    const balance = classifyTokenBalance("57c84e", 6n, null);

    expect(balance.kind).toBe("unknown");
    expect(balance.verified).toBe(false);
  });
});
