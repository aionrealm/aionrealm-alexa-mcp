import { randomUUID } from "node:crypto";

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { registerAskAionTool } from "./mcpServer.js";

// Phase 4A: multi-session lifecycle correction.
//
// Earlier versions of this file built exactly ONE McpServer + ONE
// StreamableHTTPServerTransport for the entire process lifetime and routed
// every request through it, regardless of caller or session. That is not
// the SDK's documented stateful pattern, and it broke in practice: a real
// second MCP client connecting after a first one had closed was rejected
// with "Server already initialized" (confirmed live, see the Phase 3
// verification report) because the single transport instance has no
// concept of more than one session.
//
// This file now follows @modelcontextprotocol/sdk@1.30.0's own reference
// implementation for stateful Streamable HTTP
// (node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/simpleStreamableHttp.js)
// literally: an independent McpServer + StreamableHTTPServerTransport pair
// is created per initialized session, keyed by the SDK-issued session ID,
// via the transport's own sessionIdGenerator/onsessioninitialized/onclose
// hooks -- nothing here invents its own session-ID scheme or protocol
// framing. ask_aion itself, the adapter interface, and the tool
// registration in mcpServer.js are unchanged; only how many
// server/transport pairs exist and how requests are routed to them
// changed.
//
// Two things the SDK does not provide, added here at the application
// level: a conservative idle-session TTL and a maximum concurrent-session
// cap, so an authenticated but misbehaving (or merely long-lived) caller
// cannot grow this process's memory without bound. Neither is exposed as a
// new environment variable -- the documented env contract
// (PORT/MCP_PATH/MCP_SERVER_AUTH_TOKEN/MOCK_AION_BACKEND/AION_BACKEND_*) is
// unchanged; both are optional createServer() parameters with hardcoded
// conservative defaults, intended for tests to override with short values
// rather than for operators to tune.

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

const JSONRPC_INVALID_REQUEST = -32000;
const JSONRPC_INTERNAL_ERROR = -32603;

/**
 * Builds the Express app for the MCP endpoint. Each initialized MCP session
 * gets its own McpServer + StreamableHTTPServerTransport pair (see the
 * header comment above) -- nothing is shared across sessions, and nothing
 * is created until a session actually initializes. Kept separate from
 * server.js so the test harness can spin up isolated instances against a
 * mock adapter without touching real environment/network configuration.
 *
 * @param {{
 *   adapter: import("./adapters/httpAionAdapter.js").AionAdapter,
 *   mcpPath?: string,
 *   authToken?: string | null,
 *   maxSessions?: number,
 *   sessionIdleTimeoutMs?: number,
 *   cleanupIntervalMs?: number,
 * }} options
 * @returns {Promise<{ app: import("express").Express, shutdown: () => Promise<void> }>}
 */
export async function createServer({
  adapter,
  mcpPath = "/mcp",
  authToken = null,
  maxSessions = DEFAULT_MAX_SESSIONS,
  sessionIdleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
} = {}) {
  /** @type {Map<string, { mcpServer: McpServer, transport: StreamableHTTPServerTransport, lastActivityAt: number }>} */
  const sessions = new Map();

  function touchSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  async function removeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    try {
      await session.transport.close();
    } catch (error) {
      console.error(`[mcp] error closing session ${sessionId}:`, error);
    }
  }

  async function createSession(req, res) {
    let onsessioninitializedSessionId;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the session only once the SDK confirms initialization --
        // avoids a race where a request could arrive referencing a session
        // ID before it is recorded here (same rationale as the SDK's own
        // reference server).
        onsessioninitializedSessionId = sessionId;
        sessions.set(sessionId, { mcpServer, transport, lastActivityAt: Date.now() });
      },
    });
    transport.onerror = (error) => {
      console.error("[mcp transport]", error);
    };
    transport.onclose = () => {
      const sessionId = onsessioninitializedSessionId ?? transport.sessionId;
      if (sessionId) {
        sessions.delete(sessionId);
      }
    };

    const mcpServer = new McpServer({ name: "aionrealm-alexa-mcp", version: "0.1.0" });
    registerAskAionTool(mcpServer, adapter);
    await mcpServer.connect(transport);

    await transport.handleRequest(req, res, req.body);
  }

  function sendJsonRpcError(res, statusCode, message, code = JSONRPC_INVALID_REQUEST) {
    if (res.headersSent) return;
    res.status(statusCode).json({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    });
  }

  // Reads the mcp-session-id header, distinguishing "absent" from
  // "present but malformed" (repeated header -> array; empty/whitespace
  // string) so each can be rejected with an accurate, non-leaky message.
  // Never a stack trace, backend detail, or the session map's contents.
  function readSessionId(req) {
    const raw = req.headers["mcp-session-id"];
    if (raw === undefined) return { present: false };
    if (Array.isArray(raw) || typeof raw !== "string" || !raw.trim()) {
      return { present: true, malformed: true };
    }
    return { present: true, malformed: false, sessionId: raw };
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Authentication runs before any session is created or looked up, for
  // every method this endpoint supports -- an unauthenticated caller can
  // never create a new session (POST .../initialize) or reach an existing
  // one (POST/GET/DELETE with a session ID).
  function requireAuth(req, res, next) {
    if (!authToken) return next(); // no token configured: local-dev default
    if (req.headers.authorization === `Bearer ${authToken}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  }

  app.get("/healthz", (req, res) => {
    res.json({ ok: true, service: "aionrealm-alexa-mcp", adapter: adapter.name });
  });

  app.post(mcpPath, requireAuth, async (req, res) => {
    try {
      const { present, malformed, sessionId } = readSessionId(req);

      if (malformed) {
        return sendJsonRpcError(res, 400, "Bad Request: malformed mcp-session-id header");
      }

      if (present) {
        const session = sessions.get(sessionId);
        if (!session) {
          return sendJsonRpcError(res, 404, "Session not found");
        }
        touchSession(sessionId);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        return sendJsonRpcError(res, 400, "Bad Request: No valid session ID provided");
      }

      if (sessions.size >= maxSessions) {
        return sendJsonRpcError(
          res,
          503,
          "Server is at capacity; please try again shortly.",
        );
      }

      await createSession(req, res);
    } catch (error) {
      console.error("[mcp] POST handling failed:", error);
      sendJsonRpcError(res, 500, "Internal server error", JSONRPC_INTERNAL_ERROR);
    }
  });

  app.get(mcpPath, requireAuth, async (req, res) => {
    try {
      const { malformed, sessionId } = readSessionId(req);
      if (malformed) {
        return sendJsonRpcError(res, 400, "Bad Request: malformed mcp-session-id header");
      }
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        return sendJsonRpcError(res, 404, "Session not found");
      }
      touchSession(sessionId);
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] GET handling failed:", error);
      sendJsonRpcError(res, 500, "Internal server error", JSONRPC_INTERNAL_ERROR);
    }
  });

  app.delete(mcpPath, requireAuth, async (req, res) => {
    try {
      const { malformed, sessionId } = readSessionId(req);
      if (malformed) {
        return sendJsonRpcError(res, 400, "Bad Request: malformed mcp-session-id header");
      }
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        return sendJsonRpcError(res, 404, "Session not found");
      }
      // handleRequest drives the transport's own close/cleanup, which
      // fires onclose above and removes the session from the map.
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] DELETE handling failed:", error);
      sendJsonRpcError(res, 500, "Internal server error", JSONRPC_INTERNAL_ERROR);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[express error handler]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Idle-session sweep: runs off the main request path, never blocks the
  // event loop (a single pass over an in-memory Map), and is unref()'d so
  // it never keeps the Node process alive on its own -- shutdown() below
  // still clears it explicitly (belt and suspenders) so tests and real
  // process shutdown both leave no dangling timer.
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastActivityAt > sessionIdleTimeoutMs) {
        removeSession(sessionId).catch((error) => {
          console.error(`[mcp] error expiring idle session ${sessionId}:`, error);
        });
      }
    }
  }, cleanupIntervalMs);
  cleanupInterval.unref?.();

  async function shutdown() {
    clearInterval(cleanupInterval);
    const sessionIds = [...sessions.keys()];
    await Promise.all(sessionIds.map((sessionId) => removeSession(sessionId)));
  }

  return { app, shutdown };
}
