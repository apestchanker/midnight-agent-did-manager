import crypto from "crypto";

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

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
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
