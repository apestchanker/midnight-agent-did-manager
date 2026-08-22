import { describe, expect, it } from "vitest";
import {
  deriveIndexerWsUrl,
  resolveIndexerEndpoints,
} from "../lib/providers";

// Regression cover for DID lookups failing against a wallet whose
// getConfiguration() returns an indexer the dApp's origin cannot call.
//
// 1AM's preprod build hands back a pre-authenticated URL on api-preprod.1am.xyz
// that answers browser requests with no Access-Control-Allow-Origin header. Every
// contract read goes through publicDataProvider, so that single blocked endpoint
// takes out queryContractState and contractStateObservable together — which is
// what left a selected agent showing no DID. A CORS rejection reaches JS only as
// a bare network failure, so nothing in the app could distinguish it from the
// chain simply having no record.
//
// VITE_INDEXER_URI now overrides the wallet's value, mirroring how
// VITE_PROVER_SERVER_URI already overrides config.proverServerUri.

const WALLET_HTTP = "https://api-preprod.1am.xyz/api/v4/graphql?session_token=abc123";
const WALLET_WS = "wss://api-preprod.1am.xyz/api/v4/graphql/ws?session_token=abc123";
const ENV_HTTP = "https://indexer.preprod.midnight.network/api/v3/graphql";
const ENV_WS = "wss://indexer.preprod.midnight.network/api/v3/graphql/ws";

describe("resolveIndexerEndpoints", () => {
  it("falls back to the wallet's endpoints when nothing is configured", () => {
    expect(resolveIndexerEndpoints(WALLET_HTTP, WALLET_WS, "", "")).toEqual({
      indexerUri: WALLET_HTTP,
      indexerWsUri: WALLET_WS,
      source: "wallet",
    });
  });

  it("prefers the configured endpoints over the wallet's", () => {
    expect(resolveIndexerEndpoints(WALLET_HTTP, WALLET_WS, ENV_HTTP, ENV_WS)).toEqual({
      indexerUri: ENV_HTTP,
      indexerWsUri: ENV_WS,
      source: "configured_env",
    });
  });

  it("never mixes hosts: configuring only the http URL still moves the socket off the wallet", () => {
    // Taking queries from one host and subscriptions from another would be
    // worse than either source alone, so the pair is resolved together.
    const resolved = resolveIndexerEndpoints(WALLET_HTTP, WALLET_WS, ENV_HTTP, "");
    expect(resolved.source).toBe("configured_env");
    expect(resolved.indexerWsUri).not.toBe(WALLET_WS);
    expect(resolved.indexerWsUri).toContain("indexer.preprod.midnight.network");
  });

  it("does not leak the wallet's session token once an override is configured", () => {
    const resolved = resolveIndexerEndpoints(WALLET_HTTP, WALLET_WS, ENV_HTTP, ENV_WS);
    expect(resolved.indexerUri).not.toContain("session_token");
    expect(resolved.indexerWsUri).not.toContain("session_token");
  });

  it("treats a whitespace-only override as unset rather than as an empty endpoint", () => {
    expect(resolveIndexerEndpoints(WALLET_HTTP, WALLET_WS, "   ", "  ").source).toBe("wallet");
  });
});

describe("deriveIndexerWsUrl", () => {
  it("upgrades https to wss and appends the socket path", () => {
    expect(deriveIndexerWsUrl("https://indexer.preprod.midnight.network/api/v3/graphql")).toBe(
      "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    );
  });

  it("upgrades http to ws for a local indexer", () => {
    expect(deriveIndexerWsUrl("http://127.0.0.1:8088/api/v3/graphql")).toBe(
      "ws://127.0.0.1:8088/api/v3/graphql/ws",
    );
  });

  it("does not double up the separator on a trailing slash", () => {
    expect(deriveIndexerWsUrl("https://example.test/api/v3/graphql/")).toBe(
      "wss://example.test/api/v3/graphql/ws",
    );
  });

  it("returns empty for an empty input rather than a bare '/ws'", () => {
    expect(deriveIndexerWsUrl("")).toBe("");
    expect(deriveIndexerWsUrl("   ")).toBe("");
  });
});
