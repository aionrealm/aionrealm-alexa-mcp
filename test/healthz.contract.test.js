// Coverage for the /healthz information-disclosure fix. The health
// endpoint must stay minimal (service/status only) and must never surface
// AION_BACKEND_URL, adapter.name, or any other infrastructure/credential
// detail -- even though it is intentionally unauthenticated (App Runner and
// similar platforms need to reach it without a bearer token).
import { test } from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/app.js";

const SECRET_LOOKING_BACKEND_URL = "https://internal-aion-backend.example.invalid/secret-path";

// A fake adapter whose .name embeds a URL, exactly like the real
// httpAionAdapter's `http(${baseUrl})` naming -- proves the fix isn't
// just "the mock adapter happens to have a boring name".
function createUrlLeakingAdapter() {
  return {
    name: `http(${SECRET_LOOKING_BACKEND_URL})`,
    async askAion() {
      throw new Error("not used by this test");
    },
  };
}

async function startTestServer(adapter) {
  const { app, shutdown } = await createServer({ adapter, mcpPath: "/mcp" });
  const httpServer = app.listen(0);
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const { port } = httpServer.address();
  return {
    baseUrl: new URL(`http://127.0.0.1:${port}/`),
    async close() {
      await new Promise((resolve) => httpServer.close(resolve));
      await shutdown();
    },
  };
}

test("/healthz is minimal: service and status only, no adapter field", async () => {
  const server = await startTestServer(createUrlLeakingAdapter());
  try {
    const response = await fetch(new URL("healthz", server.baseUrl));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: "ok", service: "aionrealm-alexa-mcp" });
  } finally {
    await server.close();
  }
});

test("/healthz never leaks the backend URL, however it is spelled in adapter.name", async () => {
  const server = await startTestServer(createUrlLeakingAdapter());
  try {
    const response = await fetch(new URL("healthz", server.baseUrl));
    const rawText = await response.text();
    assert.doesNotMatch(rawText, /internal-aion-backend/);
    assert.doesNotMatch(rawText, /https?:\/\//);
    assert.doesNotMatch(rawText, /adapter/i);
  } finally {
    await server.close();
  }
});

test("/healthz requires no authentication (needed for platform health checks) but still leaks nothing", async () => {
  const server = await startTestServer(createUrlLeakingAdapter());
  const { app, shutdown } = await createServer({
    adapter: createUrlLeakingAdapter(),
    mcpPath: "/mcp",
    authToken: "some-secret",
  });
  const authedHttpServer = app.listen(0);
  await new Promise((resolve, reject) => {
    authedHttpServer.once("listening", resolve);
    authedHttpServer.once("error", reject);
  });
  try {
    const { port } = authedHttpServer.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200, "healthz must stay reachable without a bearer token");
    const body = await response.json();
    assert.deepEqual(body, { status: "ok", service: "aionrealm-alexa-mcp" });
  } finally {
    await new Promise((resolve) => authedHttpServer.close(resolve));
    await shutdown();
    await server.close();
  }
});
