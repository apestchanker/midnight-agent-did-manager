import { describe, expect, it } from "vitest";
import {
  buildDid,
  createMcpKey,
  deriveAgentKey,
  normalizeWallet,
  parseRequestPath,
  readJson,
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

  it("derives a stable agent key and DID from a wallet address", () => {
    const wallet = "mn_addr_preprod1example";
    const agentKey = deriveAgentKey(wallet);

    expect(agentKey).toHaveLength(64);
    expect(buildDid({
      networkId: "preprod",
      contractAddress: "contract123",
      walletAddress: wallet,
    })).toBe(`did:midnight:preprod:contract123:${agentKey}`);
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
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.body).toBe(JSON.stringify({ ok: true }));
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
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.body).toBe("bad request");
  });
});

