import { describe, expect, it } from "vitest";
import {
  buildDid,
  createMcpKey,
  deriveAgentKey,
  encodeDerivedWalletAddress,
  generateAgentId,
  getClientIp,
  normalizeWallet,
  parseRequestPath,
  readJson,
  RequestBodyError,
  sendJson,
  sendText,
  sha256Hex,
} from "../server/utils.js";

describe("server/utils", () => {
  it("normalizes wallet addresses", () => {
    expect(normalizeWallet("  MN_ADDR_PREPROD1ABC  ")).toBe(
      "mn_addr_preprod1abc",
    );
    expect(normalizeWallet(undefined)).toBe("");
  });

  it("creates MCP keys with a hash of the plaintext token", () => {
    const key = createMcpKey();

    expect(key.keyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(key.plainText).toMatch(/^mcp_[0-9a-f-]+\.[0-9a-f]+$/i);
    expect(key.keyHash).toBe(sha256Hex(key.plainText));
  });

  it("derives a stable agent key and DID from an agent id", () => {
    const agentId = "agent-academy";
    const agentKey = deriveAgentKey(agentId);

    expect(agentKey).toHaveLength(64);
    expect(buildDid({
      networkId: "preprod",
      contractAddress: "contract123",
      agentId,
    })).toBe(`did:midnight:preprod:contract123:${agentKey}`);
  });

  it("generates system agent ids in the expected format", () => {
    const one = generateAgentId();
    const two = generateAgentId();

    expect(one).toMatch(/^agent-[0-9a-f-]{36}$/);
    expect(two).toMatch(/^agent-[0-9a-f-]{36}$/);
    expect(one).not.toBe(two);
  });

  it("parses request paths into segments", () => {
    expect(parseRequestPath("/api/admin/did-requests/123/issue")).toEqual([
      "api",
      "admin",
      "did-requests",
      "123",
      "issue",
    ]);
  });

  it("reads JSON payloads from a request stream", async () => {
    async function* body() {
      yield Buffer.from('{"hello":"world"}');
    }

    await expect(readJson(body())).resolves.toEqual({ hello: "world" });
  });

  it("rejects malformed JSON payloads", async () => {
    async function* body() {
      yield Buffer.from('{"hello":"world"}{"extra":true}');
    }

    await expect(readJson(body())).rejects.toMatchObject({
      name: "RequestBodyError",
      statusCode: 400,
      code: "malformed_json",
    } satisfies Partial<RequestBodyError>);
  });

  it("rejects JSON payloads larger than the configured limit", async () => {
    async function* body() {
      yield Buffer.from('{"hello":"world"}');
    }

    await expect(readJson(body(), { maxBytes: 4 })).rejects.toMatchObject({
      name: "RequestBodyError",
      statusCode: 413,
      code: "json_body_too_large",
    } satisfies Partial<RequestBodyError>);
  });

  it("sends JSON responses with CORS headers", () => {
    const headers = new Map<string, string>();
    const res = {
      statusCode: 0,
      body: "",
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end(value: string) {
        this.body = value;
      },
    };

    sendJson(res, 201, { ok: true });

    expect(res.statusCode).toBe(201);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.body).toBe(JSON.stringify({ ok: true }));
  });

  it("encodes a raw address hex into a Bech32m unshielded address", () => {
    const rawAddressHex =
      "9bcd03a50d2a66157e579ae37b483e45dc349341d4963f465601735225d7efb2";

    expect(encodeDerivedWalletAddress(rawAddressHex, "preprod")).toBe(
      "mn_addr_preprod1n0xs8fgd9fnp2ljhnt3hkjp7ghwrfy6p6jtr73jkq9e4yfwha7eqsr3je2",
    );
  });

  it("falls back to the raw hex unchanged when Bech32m encoding throws", () => {
    // Not valid hex, so Buffer.from(..., "hex") / the address codec will not
    // produce a well-formed 32-byte address and encoding fails.
    expect(encodeDerivedWalletAddress("not-valid-hex", "preprod")).toBe(
      "not-valid-hex",
    );
  });

  describe("getClientIp (FIX 2: Render proxy support for rate-limit keys)", () => {
    it("uses the first entry of X-Forwarded-For when present, trimmed", () => {
      const req = {
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.5, 10.0.0.1" },
        socket: { remoteAddress: "10.0.0.1" },
      };
      expect(getClientIp(req as any)).toBe("203.0.113.7");
    });

    it("trims whitespace around a single X-Forwarded-For value", () => {
      const req = {
        headers: { "x-forwarded-for": "  203.0.113.9  " },
        socket: { remoteAddress: "10.0.0.1" },
      };
      expect(getClientIp(req as any)).toBe("203.0.113.9");
    });

    it("falls back to req.socket.remoteAddress when X-Forwarded-For is absent (local/dev, no proxy)", () => {
      const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
      expect(getClientIp(req as any)).toBe("127.0.0.1");
    });

    it("falls back to req.socket.remoteAddress when X-Forwarded-For is an empty string", () => {
      const req = {
        headers: { "x-forwarded-for": "" },
        socket: { remoteAddress: "127.0.0.1" },
      };
      expect(getClientIp(req as any)).toBe("127.0.0.1");
    });

    it("returns an empty string when neither X-Forwarded-For nor a socket address is available", () => {
      const req = { headers: {}, socket: {} };
      expect(getClientIp(req as any)).toBe("");
    });
  });

  it("sends text responses with CORS headers", () => {
    const headers = new Map<string, string>();
    const res = {
      statusCode: 0,
      body: "",
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end(value: string) {
        this.body = value;
      },
    };

    sendText(res, 400, "bad request");

    expect(res.statusCode).toBe(400);
    expect(headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.body).toBe("bad request");
  });
});
