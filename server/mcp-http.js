import "./load-env.js";
import { createServer } from "http";
import { URL } from "url";
import { initializeDatabase } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import { createDidMcpApp } from "./mcp-app.js";
import { readJson, sendJson, sendText, setCorsHeaders } from "./utils.js";

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
