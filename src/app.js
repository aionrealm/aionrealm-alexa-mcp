import { randomUUID } from "node:crypto";

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerAskAionTool } from "./mcpServer.js";

/**
 * Builds the Express app + MCP server + Streamable HTTP transport, wired
 * together, but does not start listening. Kept separate from server.js so
 * the test harness can spin up isolated instances against a mock adapter
 * without touching real environment/network configuration.
 *
 * Runs in stateful Streamable HTTP mode (server-issued session IDs via
 * sessionIdGenerator). This was tried first in stateless mode
 * (sessionIdGenerator: undefined), which the spec and this SDK both
 * document as a supported mode for simple request/response tools -- but in
 * this SDK version (@modelcontextprotocol/sdk 1.30.0) the standard
 * post-initialize `notifications/initialized` notification fails silently
 * with a bare HTTP 500 (no error surfaced to onerror, Express error
 * middleware, or the caller) whenever no session ID is in play. The same
 * notification succeeds immediately once a sessionIdGenerator is supplied.
 * Stateful mode is the normal/primary mode for this transport (per the
 * SDK's own class doc comment), so this isn't a functionality loss --
 * ask_aion is still a single stateless-feeling request/response call from
 * the caller's perspective; the server just tracks a lightweight session
 * ID per connected client under the hood, entirely inside this file.
 *
 * @param {{
 *   adapter: import("./adapters/httpAionAdapter.js").AionAdapter,
 *   mcpPath?: string,
 *   authToken?: string | null,
 * }} options
 * @returns {Promise<{ app: import("express").Express, mcpServer: McpServer, transport: StreamableHTTPServerTransport }>}
 */
export async function createServer({ adapter, mcpPath = "/mcp", authToken = null }) {
  const mcpServer = new McpServer({
    name: "aionrealm-alexa-mcp",
    version: "0.1.0",
  });
  registerAskAionTool(mcpServer, adapter);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onerror = (error) => {
    console.error("[mcp transport]", error);
  };
  await mcpServer.connect(transport);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  function requireAuth(req, res, next) {
    if (!authToken) return next(); // no token configured: local-dev default
    if (req.headers.authorization === `Bearer ${authToken}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  }

  app.get("/healthz", (req, res) => {
    res.json({ ok: true, service: "aionrealm-alexa-mcp", adapter: adapter.name });
  });

  // All three methods delegate to the same transport instance -- POST for
  // JSON-RPC requests/notifications, GET to open the server-initiated
  // notification stream, DELETE to end a session. handleRequest reads the
  // `mcp-session-id` header itself to route to the right session.
  app.post(mcpPath, requireAuth, async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] POST handling failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get(mcpPath, requireAuth, async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] GET handling failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete(mcpPath, requireAuth, async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] DELETE handling failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[express error handler]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return { app, mcpServer, transport };
}
