// End-to-end proof that the ask_aion MCP tool works over real Streamable
// HTTP transport: this test starts a real HTTP server (Phase 1's actual
// app.js), connects a real MCP client (@modelcontextprotocol/sdk's client,
// same package a real MCP host uses) over that HTTP connection, lists
// tools, and calls ask_aion -- all against the safe local mock adapter, no
// network calls and no real AionRealm backend involved.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createServer } from "../src/app.js";
import { createMockAionAdapter } from "../src/adapters/mockAionAdapter.js";

async function startTestServer(options = {}) {
  const { app } = await createServer({
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
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

async function connectClient(baseUrl, opts) {
  const client = new Client({ name: "aionrealm-alexa-mcp-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(baseUrl, opts);
  await client.connect(transport);
  return client;
}

test("ask_aion is listed as an available tool", async () => {
  const server = await startTestServer();
  try {
    const client = await connectClient(server.baseUrl);
    try {
      const { tools } = await client.listTools();
      const askAion = tools.find((tool) => tool.name === "ask_aion");
      assert.ok(askAion, "ask_aion should be registered");
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
    const client = await connectClient(server.baseUrl);
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
    const client = await connectClient(server.baseUrl);
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
    const client = await connectClient(server.baseUrl, {
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
