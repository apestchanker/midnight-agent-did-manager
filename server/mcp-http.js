import "./load-env.js";
import { createServer } from "http";
import { URL } from "url";
import { initializeDatabase } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import { createDidMcpApp } from "./mcp-app.js";
import { readJson, RequestBodyError, sendJson, sendText, setCorsHeaders } from "./utils.js";

const PORT = Number(process.env.DID_MCP_PORT || 8788);
const HOST = (process.env.DID_MCP_HOST || "127.0.0.1").trim();
const app = createDidMcpApp();

installProcessLogger("mcp-http");

function getApiAuthToken(req) {
  const headerToken = req.headers["x-did-api-key"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  const authHeader = req.headers.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return "";
}

function requireApiAuth(req, res) {
  const expected = String(process.env.DID_API_AUTH_TOKEN || "").trim();
  if (!expected) {
    sendJson(res, 503, {
      ok: false,
      error: "api_auth_not_configured",
      message: "DID_API_AUTH_TOKEN is required for private MCP HTTP routes.",
    }, req);
    return false;
  }
  if (getApiAuthToken(req) !== expected) {
    sendJson(res, 401, {
      ok: false,
      error: "unauthorized",
      message: "Missing or invalid API authorization token.",
    }, req);
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request", req);
    return;
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res, req);
    res.statusCode = 204;
    res.end("");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.info(`[mcp-http] ${req.method} ${url.pathname}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, transport: "http", protocol: "mcp" }, req);
    return;
  }

  if (req.method === "GET" && url.pathname === "/logs") {
    if (!requireApiAuth(req, res)) {
      return;
    }
    sendJson(res, 200, {
      entries: getRecentLogs(Number(url.searchParams.get("limit") || "200")),
    }, req);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/.well-known/mcp" || url.pathname === "/mcp/discovery")) {
    sendJson(
      res,
      200,
      app.getDiscoveryDocument(process.env.DID_MCP_PUBLIC_BASE_URL || `http://localhost:${PORT}`),
      req,
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/mcp") {
    try {
      const payload = await readJson(req);
      const response = await app.handleRequest(payload, {
        transport: "http",
        headers: req.headers,
      });
      if (response == null) {
        res.statusCode = 204;
        res.end("");
        return;
      }
      sendJson(res, 200, response, req);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        console.warn("[mcp-http] invalid JSON payload", error.message);
        sendJson(res, error.statusCode, {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: error.code === "json_body_too_large" ? -32000 : -32700,
            message: error.code === "json_body_too_large" ? "Request body too large" : "Parse error",
            data: {
              code: error.code,
              message: error.message,
            },
          },
        }, req);
        return;
      }

      console.error("[mcp-http] request failed", error);
      sendJson(res, 500, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error),
        },
      }, req);
    }
    return;
  }

  sendText(res, 404, "Not found", req);
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`[did-mcp] listening on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("[did-mcp] failed to initialize database", error);
    process.exit(1);
  });
