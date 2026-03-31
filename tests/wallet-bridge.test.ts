import { afterEach, describe, expect, it, vi } from "vitest";

type MockConnectedApi = {
  getConfiguration: ReturnType<typeof vi.fn>;
};

function createWallet(name: string, api: MockConnectedApi) {
  return {
    name,
    icon: `${name}.png`,
    apiVersion: "4.0.0",
    connect: vi.fn(async () => api),
  };
}

describe("wallet-bridge", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("detectWallets returns every injected provider that matches the expected shape", async () => {
    const oneamApi = { getConfiguration: vi.fn() };
    const laceApi = { getConfiguration: vi.fn() };
    vi.stubGlobal("window", {
      parent: null,
      addEventListener: vi.fn(),
      midnight: {
        oneam: createWallet("1AM", oneamApi),
        lace: createWallet("lace", laceApi),
        ignored: { name: "bad-provider" },
      },
    });

    const { detectWallets } = await import("../lib/wallet-bridge");

    const wallets = await detectWallets();

    expect(wallets.map((wallet) => wallet.name)).toEqual(["1AM", "lace"]);
  });

  it("connectWallet prefers the explicitly selected wallet name", async () => {
    const oneamApi = {
      getConfiguration: vi.fn(async () => ({ networkId: "preview" })),
    };
    const laceApi = {
      getConfiguration: vi.fn(async () => ({ networkId: "preprod" })),
    };
    const oneamWallet = createWallet("1AM", oneamApi);
    const laceWallet = createWallet("lace", laceApi);

    vi.stubGlobal("window", {
      parent: null,
      addEventListener: vi.fn(),
      midnight: {
        oneam: oneamWallet,
        lace: laceWallet,
      },
    });

    const { connectWallet } = await import("../lib/wallet-bridge");

    const result = await connectWallet("lace");

    expect(result.walletName).toBe("lace");
    expect(laceWallet.connect).toHaveBeenCalled();
    expect(oneamWallet.connect).not.toHaveBeenCalled();
    expect(result.config.networkId).toBe("preprod");
  });
});
