import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock("../server/db.js", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

// FIX 1 (code review follow-up, feature 007): wraps the real
// encodeDerivedWalletAddress in a spy so tests below can assert on which
// networkId session-service.js actually passes through, while every other
// export (normalizeWallet, sha256Hex, normalizeWalletSignatureHex, and the
// real encodeDerivedWalletAddress behavior itself) is left untouched —
// existing tests in this file that don't care about networkId propagation
// keep working exactly as before.
const encodeDerivedWalletAddressMock = vi.fn();
vi.mock("../server/utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../server/utils.js")>("../server/utils.js");
  encodeDerivedWalletAddressMock.mockImplementation(actual.encodeDerivedWalletAddress);
  return {
    ...actual,
    encodeDerivedWalletAddress: (...args: unknown[]) =>
      encodeDerivedWalletAddressMock(...args),
  };
});

const ORIGINAL_ENV = { ...process.env };

describe("session-service", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
    encodeDerivedWalletAddressMock.mockClear();
    process.env.DID_AUTH_NONCE_TTL_SECONDS = "300";
    process.env.DID_SESSION_TTL_SECONDS = "1800";
    process.env.DID_AUTH_DOMAIN = "test.example";
    delete process.env.DID_ADMIN_WALLET_ADDRESS;
    delete process.env.DID_NETWORK_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  describe("issueNonce", () => {
    it("inserts an auth_nonces row and returns a domain-separated challenge (REQ-01 Scenario 01)", async () => {
      queryMock.mockResolvedValue({ rows: [] });

      const { issueNonce } = await import("../server/session-service.js");
      const result = await issueNonce("MN_ADDR_PREPROD1HOLDER");

      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toMatch(/insert into auth_nonces/i);
      expect(params[0]).toBe(result.nonce);
      expect(params[1]).toBe("mn_addr_preprod1holder");
      expect(params[2]).toBe(result.challenge);
      expect(params[3]).toBe(result.expiresAt);

      const parsed = JSON.parse(result.challenge);
      expect(parsed.type).toBe("midnight-did:auth-challenge");
      expect(parsed.purpose).toBe("wallet-session-login");
      expect(parsed.walletAddress).toBe("mn_addr_preprod1holder");
      expect(parsed.nonce).toBe(result.nonce);
      expect(parsed.nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(parsed.domain).toBe("test.example");

      const issuedAtMs = new Date(parsed.issuedAt).getTime();
      const expiresAtMs = new Date(parsed.expiresAt).getTime();
      expect(expiresAtMs - issuedAtMs).toBe(300 * 1000);
      expect(result.expiresAt).toBe(parsed.expiresAt);
    });

    it("throws before any query is made when the wallet address is empty (REQ-01 Scenario 02)", async () => {
      const { issueNonce } = await import("../server/session-service.js");

      await expect(issueNonce("")).rejects.toThrow();
      await expect(issueNonce("   ")).rejects.toThrow();
      await expect(issueNonce(undefined as unknown as string)).rejects.toThrow();

      expect(queryMock).not.toHaveBeenCalled();
    });

    it("throws before any query is made when the wallet address is malformed (REQ-01 Scenario 02)", async () => {
      const { issueNonce } = await import("../server/session-service.js");

      await expect(issueNonce("not-a-wallet-address")).rejects.toThrow();

      expect(queryMock).not.toHaveBeenCalled();
    });

    it("never issues the same nonce twice across calls", async () => {
      queryMock.mockResolvedValue({ rows: [] });

      const { issueNonce } = await import("../server/session-service.js");
      const first = await issueNonce("mn_addr_preprod1holder");
      const second = await issueNonce("mn_addr_preprod1holder");

      expect(first.nonce).not.toBe(second.nonce);
      expect(first.challenge).not.toBe(second.challenge);
    });
  });

  describe("createSessionFromSignature", () => {
    const NONCE = "11111111-1111-1111-1111-111111111111";
    const WALLET = "mn_addr_preprod1holder";
    const OTHER_WALLET = "mn_addr_preprod1someoneelse";
    const CHALLENGE = JSON.stringify({
      type: "midnight-did:auth-challenge",
      purpose: "wallet-session-login",
      walletAddress: WALLET,
      nonce: NONCE,
      issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      domain: "test.example",
    });

    function nonceRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "nonce-row-1",
        nonce: NONCE,
        wallet_address: WALLET,
        challenge: CHALLENGE,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: null,
        ...overrides,
      };
    }

    function buildInput(overrides: Record<string, unknown> = {}) {
      return {
        signature: {
          data: CHALLENGE,
          signature: "sig",
          verifyingKey: "vk",
          ...overrides,
        },
      };
    }

    it("creates a session when the signature verifies and the derived address matches the declared wallet (REQ-02 Scenario 01)", async () => {
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });
      withTransactionMock.mockImplementation(async (run: (client: unknown) => unknown) => {
        const client = {
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [nonceRow({ consumed_at: new Date().toISOString() })] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return run(client);
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      const result = await createSessionFromSignature(buildInput(), {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => WALLET),
      });

      expect(result.walletAddress).toBe(WALLET);
      expect(result.isAdmin).toBe(false);
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.expiresAt).toBeTruthy();
      expect(result).not.toHaveProperty("token_hash");
      expect(withTransactionMock).toHaveBeenCalledTimes(1);
    });

    it("FIX 1: passes DID_NETWORK_ID through to encodeDerivedWalletAddress when configured", async () => {
      process.env.DID_NETWORK_ID = "preview";
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });
      withTransactionMock.mockImplementation(async (run: (client: unknown) => unknown) => {
        const client = {
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [nonceRow({ consumed_at: new Date().toISOString() })] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return run(client);
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await createSessionFromSignature(buildInput(), {
        verifySignature: vi.fn(() => true),
        // Round-trips through encodeDerivedWalletAddress's own catch-fallback
        // (not valid hex -> returns the input unchanged), same trick the
        // "creates a session..." test above relies on, so the derived
        // address still matches the declared WALLET regardless of network.
        addressFromKey: vi.fn(() => WALLET),
      });

      expect(encodeDerivedWalletAddressMock).toHaveBeenCalledWith(WALLET, "preview");
    });

    it("FIX 1: falls back to preprod when DID_NETWORK_ID is not set", async () => {
      delete process.env.DID_NETWORK_ID;
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });
      withTransactionMock.mockImplementation(async (run: (client: unknown) => unknown) => {
        const client = {
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [nonceRow({ consumed_at: new Date().toISOString() })] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return run(client);
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await createSessionFromSignature(buildInput(), {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => WALLET),
      });

      expect(encodeDerivedWalletAddressMock).toHaveBeenCalledWith(WALLET, "preprod");
    });

    it("throws invalid_nonce when signature.data cannot be parsed as a challenge", async () => {
      const { createSessionFromSignature } = await import("../server/session-service.js");

      await expect(
        createSessionFromSignature(buildInput({ data: "not-json" }), {
          verifySignature: vi.fn(() => true),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "invalid_nonce" });

      expect(queryMock).not.toHaveBeenCalled();
      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("throws invalid_nonce when the embedded nonce does not match a persisted auth_nonces row", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => true),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "invalid_nonce" });

      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("throws nonce_already_used (409) when exchanging an already-consumed nonce (REQ-02 Scenario 03)", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [nonceRow({ consumed_at: new Date().toISOString() })],
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => true),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "nonce_already_used", statusCode: 409 });

      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("throws nonce_expired for an unconsumed nonce past its expiry (REQ-02 Scenario 04)", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [nonceRow({ expires_at: new Date(Date.now() - 1_000).toISOString() })],
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => true),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "nonce_expired" });

      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("throws invalid_signature when verifySignature rejects the signature (REQ-02 Scenario 02)", async () => {
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => false),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "invalid_signature" });

      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("throws wallet_address_mismatch when the derived address differs from the wallet declared at issuance", async () => {
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => true),
          addressFromKey: vi.fn(() => OTHER_WALLET),
        }),
      ).rejects.toMatchObject({ code: "wallet_address_mismatch" });

      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it("leaves the nonce unconsumed after a non-409 failure, so a fresh valid exchange against the same nonce can still succeed", async () => {
      // First attempt fails on signature verification — a non-409 condition.
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });
      const { createSessionFromSignature } = await import("../server/session-service.js");
      await expect(
        createSessionFromSignature(buildInput(), {
          verifySignature: vi.fn(() => false),
          addressFromKey: vi.fn(() => WALLET),
        }),
      ).rejects.toMatchObject({ code: "invalid_signature" });
      expect(withTransactionMock).not.toHaveBeenCalled();

      // A fresh, valid exchange against the SAME (still-unconsumed) nonce succeeds.
      queryMock.mockResolvedValueOnce({ rows: [nonceRow()] });
      withTransactionMock.mockImplementation(async (run: (client: unknown) => unknown) => {
        const client = {
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [nonceRow({ consumed_at: new Date().toISOString() })] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return run(client);
      });
      const result = await createSessionFromSignature(buildInput(), {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => WALLET),
      });
      expect(result.walletAddress).toBe(WALLET);
    });

    it("closes the concurrent-replay race: of two simultaneous exchanges over the same nonce, exactly one succeeds and the other fails with nonce_already_used", async () => {
      queryMock.mockResolvedValue({ rows: [nonceRow()] });

      let transactionCallCount = 0;
      withTransactionMock.mockImplementation(async (run: (client: unknown) => unknown) => {
        transactionCallCount += 1;
        const isFirst = transactionCallCount === 1;
        const client = {
          query: vi.fn().mockImplementation((sql: string) => {
            if (/update auth_nonces/i.test(sql)) {
              return Promise.resolve({
                rows: isFirst ? [nonceRow({ consumed_at: new Date().toISOString() })] : [],
              });
            }
            return Promise.resolve({ rows: [] });
          }),
        };
        return run(client);
      });

      const { createSessionFromSignature } = await import("../server/session-service.js");
      const deps = {
        verifySignature: vi.fn(() => true),
        addressFromKey: vi.fn(() => WALLET),
      };

      const results = await Promise.allSettled([
        createSessionFromSignature(buildInput(), deps),
        createSessionFromSignature(buildInput(), deps),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "nonce_already_used",
      });
    });
  });

  describe("validateSession", () => {
    it("returns null (not a thrown error) for an unknown token hash", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      const { validateSession } = await import("../server/session-service.js");
      await expect(validateSession("unknown-token")).resolves.toBeNull();
    });

    it("returns null for an expired session", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: "session-1",
            wallet_address: "mn_addr_preprod1holder",
            expires_at: new Date(Date.now() - 60_000).toISOString(),
            revoked_at: null,
          },
        ],
      });

      const { validateSession } = await import("../server/session-service.js");
      await expect(validateSession("expired-token")).resolves.toBeNull();
    });

    it("returns null for a revoked session", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: "session-2",
            wallet_address: "mn_addr_preprod1holder",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            revoked_at: new Date().toISOString(),
          },
        ],
      });

      const { validateSession } = await import("../server/session-service.js");
      await expect(validateSession("revoked-token")).resolves.toBeNull();
    });

    it("returns isAdmin: true only when the session wallet matches DID_ADMIN_WALLET_ADDRESS after normalization", async () => {
      process.env.DID_ADMIN_WALLET_ADDRESS = "MN_ADDR_PREPROD1ADMIN";
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: "session-3",
              wallet_address: "mn_addr_preprod1admin",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { validateSession } = await import("../server/session-service.js");
      const result = await validateSession("admin-token");

      expect(result).toEqual({
        walletAddress: "mn_addr_preprod1admin",
        isAdmin: true,
      });
    });

    it("returns isAdmin: false for a non-matching wallet", async () => {
      process.env.DID_ADMIN_WALLET_ADDRESS = "mn_addr_preprod1admin";
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: "session-4",
              wallet_address: "mn_addr_preprod1someoneelse",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { validateSession } = await import("../server/session-service.js");
      const result = await validateSession("non-admin-token");

      expect(result).toEqual({
        walletAddress: "mn_addr_preprod1someoneelse",
        isAdmin: false,
      });
    });

    it("does not treat a shielded-format address as matching an unshielded DID_ADMIN_WALLET_ADDRESS for the same wallet (ADR-004 trap)", async () => {
      // Same underlying wallet, two different, mutually-incompatible Bech32m
      // encodings: unshielded (server-side admin config) vs shielded
      // (VITE_ADMIN_WALLET_SHIELDED_ADDR, frontend display only).
      process.env.DID_ADMIN_WALLET_ADDRESS =
        "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2";
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: "session-5",
              wallet_address: "mn_shield-addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { validateSession } = await import("../server/session-service.js");
      const result = await validateSession("shielded-collision-token");

      expect(result?.isAdmin).toBe(false);
    });

    it("computes isAdmin as false for every session when DID_ADMIN_WALLET_ADDRESS is unset, even for a wallet that would otherwise match", async () => {
      delete process.env.DID_ADMIN_WALLET_ADDRESS;
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: "session-6",
              wallet_address: "mn_addr_preprod1wouldbeadmin",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { validateSession } = await import("../server/session-service.js");
      const result = await validateSession("fail-closed-token");

      expect(result).toEqual({
        walletAddress: "mn_addr_preprod1wouldbeadmin",
        isAdmin: false,
      });
    });
  });
});
