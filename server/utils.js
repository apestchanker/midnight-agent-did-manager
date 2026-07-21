import crypto from "crypto";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";

const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

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

export function encodeDerivedWalletAddress(rawAddressHex, networkId) {
  try {
    return MidnightBech32m.encode(
      networkId || "preprod",
      new UnshieldedAddress(Buffer.from(rawAddressHex, "hex")),
    ).toString();
  } catch {
    return rawAddressHex;
  }
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

function getAllowedOrigins() {
  const configured = String(process.env.DID_CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function getCorsOrigin(req) {
  const requestOrigin = req?.headers?.origin;
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes("*")) return "*";
  if (typeof requestOrigin === "string" && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return allowedOrigins[0] || "http://localhost:5173";
}

export function applyCorsHeaders(res, req) {
  res.setHeader("Access-Control-Allow-Origin", getCorsOrigin(req));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-MCP-Key, Authorization",
  );
}

export function sendJson(res, status, body, req) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  applyCorsHeaders(res, req);
  res.end(JSON.stringify(body));
}

export function sendText(res, status, body, req) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  applyCorsHeaders(res, req);
  res.end(body);
}

export function setCorsHeaders(res, req) {
  applyCorsHeaders(res, req);
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

// Render (and most reverse proxies/load balancers) terminate the client TCP
// connection themselves, so req.socket.remoteAddress on the app process is
// always the proxy's own address — identical for every request regardless
// of which real client sent it. Render confirms it fills in the standard
// X-Forwarded-For header with the real client IP as the FIRST entry in the
// (possibly multi-hop) comma-separated list. Used anywhere a caller's
// source IP is needed for rate-limiting keys; falls back to
// req.socket?.remoteAddress for local/dev environments with no proxy in
// front (where X-Forwarded-For is never set).
export function getClientIp(req) {
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return req?.socket?.remoteAddress || "";
}
