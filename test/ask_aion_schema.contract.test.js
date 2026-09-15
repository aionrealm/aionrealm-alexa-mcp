// Coverage for the anonymous-MVP schema tightening: ask_aion's exposed MCP
// tool schema must declare only `question` -- member_id and session_id are
// removed from what a caller can pass. The AionRealm backend contract
// itself (httpAionAdapter.js) is unchanged: it must still always send
// member_id/session_id as null, exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createServer } from "../src/app.js";
import { createMockAionAdapter } from "../src/adapters/mockAionAdapter.js";

async function startTestServer(adapter = createMockAionAdapter()) {
  const { app, shutdown } = await createServer({ adapter, mcpPath: "/mcp" });
  const httpServer = app.listen(0);
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const { port } = httpServer.address();
  return {
    baseUrl: new URL(`http://127.0.0.1:${port}/mcp`),
    async close() {
      await new Promise((resolve) => httpServer.close(resolve));
      await shutdown();
    },
  };
}

async function connectClient(baseUrl) {
  const client = new Client({ name: "schema-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(baseUrl);
  await client.connect(transport);
  return client;
}

test("ask_aion's declared input schema exposes only question", async () => {
  const server = await startTestServer();
  try {
    const client = await connectClient(server.baseUrl);
    try {
      const { tools } = await client.listTools();
      const askAion = tools.find((tool) => tool.name === "ask_aion");
      const properties = askAion.inputSchema?.properties ?? {};
      assert.deepEqual(
        Object.keys(properties).sort(),
        ["question"],
        "ask_aion must declare exactly one input property: question",
      );
      assert.ok(!("member_id" in properties), "member_id must not be exposed");
      assert.ok(!("session_id" in properties), "session_id must not be exposed");
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

test("exactly one MCP tool is exposed in total", async () => {
  const server = await startTestServer();
  try {
    const client = await connectClient(server.baseUrl);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, "ask_aion");
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }
});

test("the adapter always receives member_id/session_id as null, regardless of what a caller sends", async () => {
  const calls = [];
  const spyAdapter = {
    name: "spy",
    async askAion(input) {
      calls.push(input);
      return { text: "ok" };
    },
  };
  const server = await startTestServer(spyAdapter);
  try {
    const client = await connectClient(server.baseUrl);
    try {
      // A caller attempting to smuggle member_id/session_id through
      // arguments not in the declared schema -- the MCP layer must not
      // forward them to the adapter even if the transport lets extra keys
      // through the wire format.
      await client.callTool({
        name: "ask_aion",
        arguments: { question: "hello", member_id: "m1", session_id: "s1" },
      });
    } finally {
      await client.close();
    }
  } finally {
    await server.close();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].question, "hello");
  assert.equal(calls[0].memberId, undefined);
  assert.equal(calls[0].sessionId, undefined);
});
