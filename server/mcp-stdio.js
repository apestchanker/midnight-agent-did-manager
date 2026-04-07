import "./load-env.js";
import { initializeDatabase } from "./db.js";
import { installProcessLogger } from "./log-store.js";
import { createDidMcpApp } from "./mcp-app.js";

const app = createDidMcpApp();
installProcessLogger("mcp-stdio");
const session = {
  mcpKey: process.env.MCP_KEY || "",
  auth: null,
};

function writeMessage(message) {
  const body = JSON.stringify(message);
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

function parseMessages(onMessage) {
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const rawHeaders = buffer.slice(0, headerEnd).split("\r\n");
      const contentLengthHeader = rawHeaders.find((line) =>
        line.toLowerCase().startsWith("content-length:"),
      );
      if (!contentLengthHeader) {
        buffer = "";
        return;
      }

      const contentLength = Number(contentLengthHeader.split(":")[1]?.trim() || "0");
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) return;

      const rawMessage = buffer.slice(messageStart, messageEnd);
      buffer = buffer.slice(messageEnd);

      let parsed;
      try {
        parsed = JSON.parse(rawMessage);
      } catch (error) {
        writeMessage({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
            data: error instanceof Error ? error.message : String(error),
          },
        });
        continue;
      }

      void onMessage(parsed);
    }
  });
}

initializeDatabase()
  .then(() => {
    parseMessages(async (message) => {
      const response = await app.handleRequest(message, {
        transport: "stdio",
        session,
      });
      if (response != null) {
        writeMessage(response);
      }
    });
  })
  .catch((error) => {
    console.error("[did-mcp-stdio] failed to initialize database", error);
    process.exit(1);
  });
