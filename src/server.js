import "dotenv/config";

import { createServer } from "./app.js";
import { createAionAdapter } from "./adapters/aionAdapter.js";

const PORT = Number(process.env.PORT) || 3333;
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const AUTH_TOKEN = process.env.MCP_SERVER_AUTH_TOKEN || null;

const adapter = createAionAdapter();

const { app } = await createServer({ adapter, mcpPath: MCP_PATH, authToken: AUTH_TOKEN });

app.listen(PORT, () => {
  console.log(`AionRealm Alexa+ MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
  console.log(`Aion backend adapter: ${adapter.name}`);
  if (!AUTH_TOKEN) {
    console.warn(
      "[warning] MCP_SERVER_AUTH_TOKEN is not set -- this endpoint accepts unauthenticated " +
        "requests. Fine for local development; set it before exposing this server publicly.",
    );
  }
});
