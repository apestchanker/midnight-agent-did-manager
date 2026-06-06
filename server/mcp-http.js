import "./load-env.js";
import { createServer } from "http";
import { URL } from "url";
import { initializeDatabase } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import { createDidMcpApp } from "./mcp-app.js";
import { readJson, RequestBodyError, sendJson, sendText, setCorsHeaders } from "./utils.js";

const PORT = Number(process.env.DID_MCP_PORT || 8788);
const app = createDidMcpApp();

installProcessLogger("mcp-http");

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request");
    return;
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end("");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.info(`[mcp-http] ${req.method} ${url.pathname}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, transport: "http", protocol: "mcp" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/logs") {
    sendJson(res, 200, {
      entries: getRecentLogs(Number(url.searchParams.get("limit") || "200")),
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/.well-known/mcp" || url.pathname === "/mcp/discovery")) {
    sendJson(
      res,
      200,
      app.getDiscoveryDocument(process.env.DID_MCP_PUBLIC_BASE_URL || `http://localhost:${PORT}`),
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
      sendJson(res, 200, response);
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
        });
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
      });
    }
    return;
  }

  sendText(res, 404, "Not found");
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[did-mcp] listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("[did-mcp] failed to initialize database", error);
    process.exit(1);
  });
