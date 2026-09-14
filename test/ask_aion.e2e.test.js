// End-to-end proof that the ask_aion MCP tool works over real Streamable
// HTTP transport, and (Phase 4A) that the per-session lifecycle correction
// in app.js actually behaves as a real MCP host would require: this test
// starts a real HTTP server (app.js, unmodified by this file), connects
// real MCP clients (@modelcontextprotocol/sdk's client, same package a
// genuine MCP host uses) over real Streamable HTTP, and drives them exactly
// as a client would -- all against the safe local mock adapter, no network
// calls and no real AionRealm backend involved.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createServer } from "../src/app.js";
import { createMockAionAdapter } from "../src/adapters/mockAionAdapter.js";

async function startTestServer(options = {}) {
  const { app, shutdown } = await createServer({
    adapter: createMockAionAdapter(),
    mcpPath: "/mcp",
    ...options,
  });
  const httpServer = app.listen(0);
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const { port } = httpServer.address();
  return {
    httpServer,
    baseUrl: new URL(`http://127.0.0.1:${port}/mcp`),
    async close() {
      // Order matters for a clean shutdown: stop accepting new requests,
      // then close every live session and clear the idle-sweep timer.
      await new Promise((resolve) => httpServer.close(resolve));
      await shutdown();
    },
  };
}

async function connectClient(baseUrl, opts) {
  const client = new Client({ name: "aionrealm-alexa-mcp-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(baseUrl, opts);
  await client.connect(transport);
  return { client, transport };
}

test("ask_aion is listed as an available tool", async () => {
  const server = await startTestServer();
  try {
    const { client } = await connectClient(server.baseUrl);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 1, "only ask_aion should be registered");
      const askAion = tools[0];
      assert.equal(askAion.name, "ask_aion");
      assert.equal(typeof askAion.description, "string");
      assert.ok(askAion.inputSchema?.properties?.question, "question should be a declared input");
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

test("ask_aion returns Aion's (mocked) response end-to-end over Streamable HTTP", async () => {
  const server = await startTestServer();
  try {
    const { client } = await connectClient(server.baseUrl);
    try {
      const result = await client.callTool({
        name: "ask_aion",
        arguments: { question: "Tell me about the orishas" },
      });

      assert.notEqual(result.isError, true, "tool call should not report an error");
      assert.equal(result.content?.[0]?.type, "text");
      assert.match(result.content[0].text, /orisha/i);
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

test("ask_aion reports an error result for an empty question via input validation", async () => {
  const server = await startTestServer();
  try {
    const { client } = await connectClient(server.baseUrl);
    try {
      const result = await client.callTool({ name: "ask_aion", arguments: { question: "" } });
      assert.equal(result.isError, true, "empty question should be reported as a tool error");
      assert.match(result.content?.[0]?.text ?? "", /question must not be empty/i);
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

test("unauthenticated requests are rejected when MCP_SERVER_AUTH_TOKEN is set", async () => {
  const server = await startTestServer({ authToken: "test-secret" });
  try {
    await assert.rejects(() => connectClient(server.baseUrl));
  } finally {
    await server.close();
  }
});

test("requests are accepted with the correct bearer token", async () => {
  const server = await startTestServer({ authToken: "test-secret" });
  try {
    const { client } = await connectClient(server.baseUrl, {
      requestInit: { headers: { Authorization: "Bearer test-secret" } },
    });
    try {
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "ask_aion"));
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

// --- Phase 4A: per-session lifecycle -------------------------------------

test("after a client closes, a second independent client can initialize and call successfully", async () => {
  const server = await startTestServer();
  try {
    const first = await connectClient(server.baseUrl);
    const firstSessionId = first.transport.sessionId;
    const firstResult = await first.client.callTool({
      name: "ask_aion",
      arguments: { question: "What is a bóveda?" },
    });
    assert.notEqual(firstResult.isError, true);
    await first.client.close();

    const second = await connectClient(server.baseUrl);
    try {
      assert.notEqual(
        second.transport.sessionId,
        firstSessionId,
        "the second client must get its own independent session ID",
      );
      const { tools } = await second.client.listTools();
      assert.ok(tools.some((tool) => tool.name === "ask_aion"));
      const secondResult = await second.client.callTool({
        name: "ask_aion",
        arguments: { question: "What is Santeria?" },
      });
      assert.notEqual(secondResult.isError, true);
    } finally {
      await second.client.close();
    }
  } finally {
    await server.close();
  }
});

test("two clients operate concurrently without sharing state", async () => {
  const server = await startTestServer();
  try {
    const a = await connectClient(server.baseUrl);
    const b = await connectClient(server.baseUrl);
    try {
      assert.notEqual(a.transport.sessionId, b.transport.sessionId);

      const [resultA, resultB] = await Promise.all([
        a.client.callTool({ name: "ask_aion", arguments: { question: "Tell me about the orishas" } }),
        b.client.callTool({ name: "ask_aion", arguments: { question: "What is Santeria?" } }),
      ]);

      assert.notEqual(resultA.isError, true);
      assert.notEqual(resultB.isError, true);
    } finally {
      await a.client.close();
      await b.client.close();
    }
  } finally {
    await server.close();
  }
});

test("an unknown session ID is rejected without creating or leaking state", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": "00000000-0000-4000-8000-000000000000",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(typeof body.error?.message, "string");
    // Sanitized: no internal detail, session map contents, or stack trace.
    assert.doesNotMatch(JSON.stringify(body), /session.*\{|Map|at file:|node_modules/i);
  } finally {
    await server.close();
  }
});

test("a malformed mcp-session-id header is rejected", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": "   ",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});

test("DELETE removes the session -- it cannot be reused afterward", async () => {
  const server = await startTestServer();
  try {
    const { client, transport } = await connectClient(server.baseUrl);
    const sessionId = transport.sessionId;
    assert.ok(sessionId, "session should be established after initialize");

    await transport.terminateSession();

    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    assert.equal(response.status, 404, "the terminated session must no longer be reachable");

    await client.close();
  } finally {
    await server.close();
  }
});

test("idle sessions expire after the configured TTL", async () => {
  const server = await startTestServer({
    sessionIdleTimeoutMs: 100,
    cleanupIntervalMs: 30,
  });
  try {
    const { client, transport } = await connectClient(server.baseUrl);
    const sessionId = transport.sessionId;

    await new Promise((resolve) => setTimeout(resolve, 300));

    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    assert.equal(response.status, 404, "an idle-expired session must no longer be reachable");

    await client.close();
  } finally {
    await server.close();
  }
});

test("the maximum concurrent-session limit is enforced", async () => {
  const server = await startTestServer({ maxSessions: 1 });
  try {
    const first = await connectClient(server.baseUrl);
    try {
      const response = await fetch(server.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          id: 1,
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "over-capacity-client", version: "0.0.1" },
          },
        }),
      });
      assert.equal(response.status, 503, "a session beyond the configured cap must be rejected");
    } finally {
      await first.client.close();
    }
  } finally {
    await server.close();
  }
});

test("shutdown() closes the HTTP listener and active sessions, and is safe to call twice", async () => {
  const server = await startTestServer();

  // An active session exists when close() runs -- prove shutdown tears it
  // down along with the listener, not just an already-idle server. The
  // client is closed first (as every other test in this file does):
  // Node's http.Server.close() only calls back once all open connections
  // (including the MCP transport's SSE stream) have ended, so leaving the
  // client connected would hang server.close() forever -- that is a test
  // ordering requirement, not a defect in shutdown() itself.
  const { client } = await connectClient(server.baseUrl);
  const result = await client.callTool({ name: "ask_aion", arguments: { question: "What is a bóveda?" } });
  assert.notEqual(result.isError, true);
  await client.close();

  await server.close();

  // The HTTP listener must actually be closed -- a new connection attempt
  // is refused, not merely "session not found".
  await assert.rejects(
    () => fetch(server.baseUrl, { method: "POST" }),
    (error) => {
      assert.match(String(error?.cause?.code ?? error), /ECONNREFUSED|EADDRNOTAVAIL|ConnectionRefused|fetch failed/i);
      return true;
    },
    "the listener should refuse new connections after shutdown",
  );

  // Calling the full close/shutdown sequence again must not throw --
  // clearInterval on an already-cleared timer and closing an
  // already-closed listener are both no-ops, and shutdown() has nothing
  // left in its session map to iterate.
  await assert.doesNotReject(() => server.close());
});

test("unauthenticated requests cannot create a session or reach an existing one", async () => {
  const server = await startTestServer({ authToken: "test-secret" });
  try {
    // Cannot create: no Authorization header on an initialize request.
    const createAttempt = await fetch(server.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "unauthenticated-client", version: "0.0.1" },
        },
      }),
    });
    assert.equal(createAttempt.status, 401);

    // Cannot access: a real session created with the correct token must
    // still be unreachable to a caller that omits it.
    const { client, transport } = await connectClient(server.baseUrl, {
      requestInit: { headers: { Authorization: "Bearer test-secret" } },
    });
    try {
      const accessAttempt = await fetch(server.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": transport.sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
      });
      assert.equal(accessAttempt.status, 401);
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});
