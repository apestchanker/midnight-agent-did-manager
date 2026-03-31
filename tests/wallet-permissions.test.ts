import { describe, expect, it, vi } from "vitest";
import {
  REQUIRED_WALLET_PERMISSIONS,
  requestWalletPermissionsIfSupported,
} from "../lib/wallet-permissions";

describe("requestWalletPermissionsIfSupported", () => {
  it("calls hintUsage when the wallet supports it", async () => {
    const hintUsage = vi.fn(async () => undefined);
    const api = {
      hintUsage,
    };

    await requestWalletPermissionsIfSupported(api as never);

    expect(hintUsage).toHaveBeenCalledTimes(1);
    expect(hintUsage).toHaveBeenCalledWith(REQUIRED_WALLET_PERMISSIONS);
  });

  it("does nothing when hintUsage is not implemented", async () => {
    const api = {};

    await expect(
      requestWalletPermissionsIfSupported(api as never),
    ).resolves.toBeUndefined();
  });
});
