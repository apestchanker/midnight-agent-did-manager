import { describe, expect, it } from "vitest";
import { explorerTxUrl } from "../src/lib/explorer";

describe("explorerTxUrl", () => {
  it("builds an explorer URL for a tx reference", () => {
    const url = explorerTxUrl("abc123");

    expect(url).toContain("https://explorer.1am.xyz/tx/abc123");
    expect(url).toContain("network=preprod");
  });
});

