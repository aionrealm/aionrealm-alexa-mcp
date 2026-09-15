// Coverage for the timing-safe bearer-token comparison in app.js's
// requireAuth/isValidBearerToken. Exercises valid, invalid, malformed, and
// missing Authorization headers against a real server (mock adapter, no
// network), asserting the exact same clean 401 behavior as before --
// nothing about the *external* contract should change, only how the
// comparison itself is made internally.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/app.js";
import { createMockAionAdapter } from "../src/adapters/mockAionAdapter.js";

async function startTestServer(options = {}) {
  const { app, shutdown } = await createServer({
    adapter: createMockAionAdapter(),
    mcpPath: "/mcp",
    authToken: "correct-secret",
    ...options,
  });
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

function initializeRequestBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    id: 1,
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "auth-test-client", version: "0.0.1" },
    },
  });
}

async function postInitialize(baseUrl, headers = {}) {
  return fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeRequestBody(),
  });
}

test("valid bearer token is accepted", async () => {
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl, {
      Authorization: "Bearer correct-secret",
    });
    assert.notEqual(response.status, 401);
  } finally {
    await server.close();
  }
});

test("invalid (well-formed but wrong) bearer token is rejected with a clean 401", async () => {
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl, {
      Authorization: "Bearer wrong-secret",
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.deepEqual(body, { error: "Unauthorized" });
  } finally {
    await server.close();
  }
});

test("a bearer token of the same length as the correct one, differing only in the last character, is rejected", async () => {
  // Same length as "correct-secret" -- specifically exercises the
  // timingSafeEqual branch rather than the length-mismatch shortcut.
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl, {
      Authorization: "Bearer correct-secreX",
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("a malformed Authorization header (missing 'Bearer ' prefix) is rejected with a clean 401", async () => {
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl, {
      Authorization: "correct-secret",
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.deepEqual(body, { error: "Unauthorized" });
  } finally {
    await server.close();
  }
});

test("a missing Authorization header is rejected with a clean 401", async () => {
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.deepEqual(body, { error: "Unauthorized" });
  } finally {
    await server.close();
  }
});

test("an empty-string Authorization header is rejected, not treated as a length-zero match", async () => {
  const server = await startTestServer();
  try {
    const response = await postInitialize(server.baseUrl, { Authorization: "" });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

