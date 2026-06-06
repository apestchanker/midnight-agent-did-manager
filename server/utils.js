import crypto from "crypto";

const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyError extends Error {
  constructor(message, { statusCode = 400, code = "invalid_json_body" } = {}) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function uniqueScopes(scopes) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))]
    : [];
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeWallet(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAgentId(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeWalletSignatureHex(value, minimumHexLength = 64) {
  const raw = String(value || "").trim();
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length % 2 !== 0) {
    return raw;
  }
  try {
    const decoded = Buffer.from(raw, "hex").toString("utf8").trim();
    if (/^[0-9a-f]+$/i.test(decoded) && decoded.length >= minimumHexLength) {
      return decoded;
    }
  } catch {
    // fall through
  }
  return raw;
}

export function generateAgentId() {
  return `agent-${crypto.randomUUID().toLowerCase()}`;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createMcpKey() {
  const keyId = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString("hex");
  const plainText = `mcp_${keyId}.${secret}`;
  return {
    keyId,
    plainText,
    keyHash: sha256Hex(plainText),
  };
}

export async function readJson(req, options = {}) {
  const maxBytes = Number(options.maxBytes || process.env.DID_MAX_JSON_BODY_BYTES || DEFAULT_MAX_JSON_BODY_BYTES);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new RequestBodyError("Invalid JSON body size limit.", {
      statusCode: 500,
      code: "invalid_json_body_limit",
    });
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new RequestBodyError(`JSON body exceeds ${maxBytes} byte limit.`, {
        statusCode: 413,
        code: "json_body_too_large",
      });
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch (error) {
    throw new RequestBodyError(
      error instanceof Error ? error.message : "Malformed JSON payload.",
      {
        statusCode: 400,
        code: "malformed_json",
      },
    );
  }
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MCP-Key, Authorization");
  res.end(JSON.stringify(body));
}

export function sendText(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MCP-Key, Authorization");
  res.end(body);
}

export function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MCP-Key, Authorization");
}

export function deriveAgentKey(agentId) {
  return sha256Hex(normalizeAgentId(agentId));
}

export function buildDid({ networkId, contractAddress, agentId }) {
  return `did:midnight:${networkId}:${contractAddress}:${deriveAgentKey(agentId)}`;
}

export function parseRequestPath(pathname) {
  return pathname.split("/").filter(Boolean);
}
