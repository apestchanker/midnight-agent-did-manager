import { describe, expect, it, vi } from "vitest";

vi.mock("@midnight-ntwrk/ledger-v8", () => ({
  Transaction: {
    deserialize: vi.fn(() => ({ identifiers: () => ["txid"] })),
  },
}));

vi.mock("@midnight-ntwrk/midnight-js-indexer-public-data-provider", () => ({
  indexerPublicDataProvider: vi.fn(() => ({ mocked: true })),
}));

vi.mock("@midnight-ntwrk/midnight-js-network-id", () => ({
  setNetworkId: vi.fn(),
}));

vi.mock("@midnight-ntwrk/midnight-js-types", () => ({
  createProverKey: vi.fn(),
  createProofProvider: vi.fn((provider) => provider),
  createVerifierKey: vi.fn(),
  createZKIR: vi.fn(),
  ZKConfigProvider: class {},
}));

vi.mock("../lib/patched-private-state-provider", () => ({
  createPatchedSdkPrivateStateProvider: vi.fn(),
}));

describe("providers reconnect", () => {
  it("routes connectedAPI calls through the reconnectable current wallet session", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5174" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("WebSocket", class {});

    const firstApi = {
      getConfiguration: vi.fn(async () => ({
        networkId: "preprod",
        indexerUri: "https://example.com/graphql",
        indexerWsUri: "wss://example.com/graphql/ws",
        substrateNodeUri: "https://example.com/rpc",
        proverServerUri: "http://127.0.0.1:6300",
      })),
      getShieldedAddresses: vi.fn(async () => ({
        shieldedAddress: "shielded1",
        shieldedCoinPublicKey: "coin" as never,
        shieldedEncryptionPublicKey: "enc" as never,
      })),
      getUnshieldedAddress: vi.fn(async () => ({
        unshieldedAddress: "addr1",
      })),
      getProvingProvider: vi.fn(),
      balanceUnsealedTransaction: vi.fn(),
      submitTransaction: vi.fn(),
      hintUsage: vi.fn(async () => undefined),
    };
    let activeApi = firstApi;
    firstApi.getConfiguration.mockImplementationOnce(async () => ({
      networkId: "preprod",
      indexerUri: "https://example.com/graphql",
      indexerWsUri: "wss://example.com/graphql/ws",
      substrateNodeUri: "https://example.com/rpc",
      proverServerUri: "http://127.0.0.1:6300",
    }));
    firstApi.getConfiguration.mockImplementation(async () => {
      throw new Error("not connected to wallet");
    });
    const secondApi = {
      ...firstApi,
      getConfiguration: vi.fn(async () => ({
        networkId: "preprod",
        indexerUri: "https://example.com/graphql",
        indexerWsUri: "wss://example.com/graphql/ws",
        substrateNodeUri: "https://example.com/rpc",
        proverServerUri: "http://127.0.0.1:6300",
      })),
      getShieldedAddresses: vi.fn(async () => ({
        shieldedAddress: "shielded1",
        shieldedCoinPublicKey: "coin" as never,
        shieldedEncryptionPublicKey: "enc" as never,
      })),
      getUnshieldedAddress: vi.fn(async () => ({
        unshieldedAddress: "addr1",
      })),
    };

    const reconnect = vi.fn(async () => {
      activeApi = secondApi;
      return activeApi as never;
    });
    const onReconnect = vi.fn();

    const { buildProviders } = await import("../lib/providers");
    const providers = await buildProviders(activeApi as never, {
      reconnect,
      onReconnect,
      storageMode: "app_local",
    });

    await expect(providers.connectedAPI.getConfiguration()).resolves.toMatchObject({
      networkId: "preprod",
    });

    expect(reconnect).toHaveBeenCalled();
    expect(onReconnect).toHaveBeenCalled();
    expect(providers.connectedAPI).toBeTruthy();
  });
});
