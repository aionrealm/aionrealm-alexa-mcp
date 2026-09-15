// Tiny local server for the "Simulated Alexa+ device experience" hackathon
// demo. This is NOT part of the MCP server and is NOT required to run it --
// see ../README.md for the actual MCP server.
//
// Why this exists at all: the live MCP server requires
// MCP_SERVER_AUTH_TOKEN. A pure static/browser demo would have to embed
// that token in client-side JavaScript to call the server directly, which
// this project's own security boundaries explicitly rule out (see
// ../README.md "Security boundaries"). This server is the fix: it holds
// MCP_SERVER_AUTH_TOKEN server-side only, and the browser talks to *this*
// server over a same-origin API that never touches or returns the token.
//
// Two modes:
//   - Real mode (default, once configured): connects to the live App
//     Runner MCP server with the real SDK client and makes a genuine
//     ask_aion call for every question.
//   - Mock mode (DEMO_MOCK=true): returns canned responses with no network
//     call at all. For local UI iteration only -- never use this to record
//     the actual submission demo video.
import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.DEMO_PORT) || 4000;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "";
const MCP_SERVER_AUTH_TOKEN = process.env.MCP_SERVER_AUTH_TOKEN || "";
const MOCK = String(process.env.DEMO_MOCK || "").toLowerCase() === "true";

if (!MOCK && (!MCP_SERVER_URL || !MCP_SERVER_AUTH_TOKEN)) {
  console.error(
    "[demo] MCP_SERVER_URL and MCP_SERVER_AUTH_TOKEN are required for real mode. " +
      "Set both in demo/.env, or run `npm run mock` for local UI iteration without them.",
  );
  process.exit(1);
}

const MOCK_RESPONSES = [
  {
    match: /speak with aion|talk to aion/i,
    text:
      "I am here. Aion, Keeper of the Realm, listens. (Mock response -- start this server without " +
      "DEMO_MOCK for a real Living Aion answer.)",
  },
  {
    match: /what is aionrealm/i,
    text:
      "AionRealm is a curated spiritual environment rooted in four living traditions: Santeria, " +
      "21 Divisiones, Palo, and Espiritismo. (Mock response -- start this server without DEMO_MOCK " +
      "for a real Living Aion answer.)",
  },
];
const MOCK_DEFAULT =
  "Aion hears your question. (Mock response -- start this server without DEMO_MOCK for a real " +
  "Living Aion answer.)";

// Held open for the lifetime of this process and reused across requests --
// avoids a fresh MCP handshake (and a fresh session on the live server) for
// every single demo interaction. Created lazily on first real request so
// mock mode never touches the network at all.
let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const client = new Client({ name: "aionrealm-alexa-mcp-demo", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_SERVER_AUTH_TOKEN}` },
        },
      });
      await client.connect(transport);
      console.log("[demo] connected to live MCP server:", MCP_SERVER_URL);
      return client;
    })();
  }
  return sessionPromise;
}

async function askAionReal(question) {
  const client = await getSession();
  const result = await client.callTool({ name: "ask_aion", arguments: { question } });
  if (result.isError) {
    const message = result.content?.[0]?.text || "Aion could not be reached right now.";
    throw new Error(message);
  }
  const text = result.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Empty response from Aion.");
  }
  return text;
}

async function askAionMock(question) {
  await new Promise((resolve) => setTimeout(resolve, 600)); // feel roughly real
  const canned = MOCK_RESPONSES.find((entry) => entry.match.test(question));
  return canned ? canned.text : MOCK_DEFAULT;
}

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({ mode: MOCK ? "mock" : "real" });
});

app.post("/api/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    return res.status(400).json({ error: "A question is required." });
  }
  try {
    const text = MOCK ? await askAionMock(question) : await askAionReal(question);
    res.json({ text });
  } catch (error) {
    // Never leak the bearer token, the MCP server URL, or transport
    // internals to the browser -- log server-side only, same discipline
    // as the MCP server's own ask_aion handler.
    console.error("[demo] ask_aion failed:", error);
    res.status(502).json({ error: "Aion could not be reached right now. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(
    `[demo] Simulated Alexa+ device demo listening on http://localhost:${PORT} (mode: ${
      MOCK ? "mock" : "real"
    })`,
  );
});
