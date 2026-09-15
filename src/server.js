import "dotenv/config";

import { createServer } from "./app.js";
import { createAionAdapter } from "./adapters/aionAdapter.js";
import { resolveAuthToken } from "./authConfig.js";

const PORT = Number(process.env.PORT) || 3333;
const MCP_PATH = process.env.MCP_PATH || "/mcp";
// Throws and crashes startup if MCP_SERVER_AUTH_TOKEN is unset and
// MCP_ALLOW_NO_AUTH=true was not explicitly set -- see authConfig.js.
const AUTH_TOKEN = resolveAuthToken();

const adapter = createAionAdapter();

const { app, shutdown } = await createServer({ adapter, mcpPath: MCP_PATH, authToken: AUTH_TOKEN });

const httpServer = app.listen(PORT, () => {
  console.log(`AionRealm Alexa+ MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
  console.log(`Aion backend adapter: ${adapter.name}`);
  if (!AUTH_TOKEN) {
    console.warn(
      "[warning] Running with MCP_ALLOW_NO_AUTH=true -- this endpoint accepts unauthenticated " +
        "requests. This must only ever be used for local development. Set MCP_SERVER_AUTH_TOKEN " +
        "(and unset MCP_ALLOW_NO_AUTH) before exposing this server publicly.",
    );
  }
});

// Close every active session (and the idle-sweep timer inside shutdown())
// on process shutdown, mirroring the SDK's own reference server pattern --
// otherwise a rolling deploy/restart would just drop sessions mid-flight
// with no attempt at a clean close.
async function handleShutdownSignal(signal) {
  console.log(`[server] received ${signal}, shutting down...`);
  try {
    await shutdown();
  } catch (error) {
    console.error("[server] error during session shutdown:", error);
  }
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", () => {
  handleShutdownSignal("SIGINT");
});
process.on("SIGTERM", () => {
  handleShutdownSignal("SIGTERM");
});
