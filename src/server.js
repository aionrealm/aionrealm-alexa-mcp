import "dotenv/config";

import { createServer } from "./app.js";
import { createAionAdapter } from "./adapters/aionAdapter.js";

const PORT = Number(process.env.PORT) || 3333;
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const AUTH_TOKEN = process.env.MCP_SERVER_AUTH_TOKEN || null;

const adapter = createAionAdapter();

const { app, shutdown } = await createServer({ adapter, mcpPath: MCP_PATH, authToken: AUTH_TOKEN });

const httpServer = app.listen(PORT, () => {
  console.log(`AionRealm Alexa+ MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
  console.log(`Aion backend adapter: ${adapter.name}`);
  if (!AUTH_TOKEN) {
    console.warn(
      "[warning] MCP_SERVER_AUTH_TOKEN is not set -- this endpoint accepts unauthenticated " +
        "requests. Fine for local development; set it before exposing this server publicly.",
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
