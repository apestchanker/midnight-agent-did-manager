import "./load-env.js";
import { createServer } from "http";
import { URL, fileURLToPath } from "url";
import { initializeDatabase } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import { createDidMcpApp } from "./mcp-app.js";
import {
  isOriginAllowed,
  readJson,
  RequestBodyError,
  sendJson,
  sendText,
  setCorsHeaders,
} from "./utils.js";
import { validateSession } from "./session-service.js";

const PORT = Number(process.env.PORT || process.env.DID_MCP_PORT || 8788);
const HOST = (process.env.DID_MCP_HOST || "127.0.0.1").trim();
const app = createDidMcpApp();

installProcessLogger("mcp-http");

// Code review follow-up (feature 007, post-verify): the shared-secret
// X-DID-API-Key header was the ADR-005 predecessor to session-token bearer
// auth and was retired as a hard cutover, no dual-accept window. This
// function now only reads Authorization: Bearer, matching
// src/utils/serviceApi.ts and server/index.js's getApiAuthToken.
function getApiAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return "";
}

// Duplicated verbatim from server/index.js per ADR-005 — the two files are
// separate process entrypoints with no shared runtime module beyond
// db.js/utils.js/session-service.js, all of which are already imported by
// both. Replaces the old shared-secret requireApiAuth/DID_API_AUTH_TOKEN
// check on GET /logs.
async function requireSession(req, res, url, parts, { admin = false } = {}) {
  if (!req.session) {
    const token = getApiAuthToken(req);
    const session = await validateSession(token);
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
        message: "Missing or invalid session.",
      }, req);
      return false;
    }
    req.session = session;
  }

  if (admin) {
    const adminConfigured = String(process.env.DID_ADMIN_WALLET_ADDRESS || "").trim();
    if (!adminConfigured) {
      sendJson(res, 503, {
        ok: false,
        error: "admin_auth_not_configured",
        message: "DID_ADMIN_WALLET_ADDRESS is required for admin routes.",
      }, req);
      return false;
    }
    if (!req.session.isAdmin) {
      sendJson(res, 403, {
        ok: false,
        error: "forbidden",
        message: "Administrator session required.",
      }, req);
      return false;
    }
  }

  return true;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request", req);
    return;
  }

  // DNS-rebinding guard, ahead of every route including the preflight. Callers
  // without an Origin header (agents, curl, SDK clients, Render health checks)
  // are unaffected — see isOriginAllowed.
  if (!isOriginAllowed(req)) {
    console.warn(`[mcp-http] rejected disallowed Origin: ${req.headers.origin}`);
    sendJson(res, 403, {
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Forbidden: request Origin is not allowed",
      },
    }, req);
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
    if (!(await requireSession(req, res, url, undefined, { admin: true }))) {
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

  // Protocol version 2026-07-28 removed the GET stream endpoint and
  // protocol-level sessions. A server on this revision answers the older
  // GET/DELETE mechanics with 405 rather than pretending to support them.
  if (url.pathname === "/mcp" && (req.method === "GET" || req.method === "DELETE")) {
    res.setHeader("Allow", "POST");
    sendText(res, 405, "Method Not Allowed", req);
    return;
  }

  if (req.method === "POST" && url.pathname === "/mcp") {
    try {
      const payload = await readJson(req);
      // The era is decided by the request itself: per-request `_meta` protocol
      // version means modern, anything else (including `initialize`) is legacy.
      // Only modern responses map JSON-RPC errors onto non-200 HTTP statuses —
      // that mapping is what lets a dual-era client tell the eras apart.
      const modern = app.isModernRequest(payload);
      const response = await app.handleRequest(payload, {
        transport: "http",
        headers: req.headers,
      });
      if (response == null) {
        // Accepted notification: 202 with no body.
        res.statusCode = 202;
        res.end("");
        return;
      }
      sendJson(res, app.getHttpStatusForResponse(response, modern), response, req);
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

// Only auto-initialize the database and start listening when this file is
// run directly (`node server/mcp-http.js` / `npm run dev:mcp:http`), not
// when it's imported — e.g. by tests that need the `server` instance and
// requireSession without a real DB connection or a real listen() on
// import. Production behavior is unchanged.
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
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
}

export { server, requireSession };
