# Simulated Alexa+ device demo

A small, self-contained demo harness — **not** the MCP server, and not required to run it (see the [main README](../README.md)). It exists to give hackathon judges a polished, visual way to see the live MCP server work, while direct Alexa+ Toolkit/simulator access is pending Amazon partner approval.

**This is clearly labeled in the UI itself as a simulation.** It is not the Alexa+ product and does not claim to be. Every response it shows, however, is real: this demo's own tiny local server holds the MCP session and makes genuine `ask_aion` calls to the same live AWS App Runner MCP server documented in the main README — nothing is faked or scripted in the browser.

## Why a local server at all?

The live MCP server requires `MCP_SERVER_AUTH_TOKEN`. A pure static-HTML/browser demo would have to embed that token in client-side JavaScript to call the server directly — this repository's own security boundaries rule that out. So this demo has a minimal Express server (`server.js`) that holds the token server-side only; the browser only ever talks to this local server's own same-origin `/api/ask` endpoint, which never returns the token.

## Setup

```bash
cd demo
npm install
cp .env.example .env
```

Fill in `.env`:
- `MCP_SERVER_URL` — the live MCP server's Streamable HTTP endpoint (see the main README for where this is documented; not published here as a bare literal to avoid inviting unauthenticated traffic).
- `MCP_SERVER_AUTH_TOKEN` — the same token configured on the live server.

## Running it

```bash
npm start
```

Open `http://localhost:4000`. Every question you ask makes a real MCP `tools/call` to the live server.

```bash
npm run mock
```

Runs the same UI against canned local responses with **no** network call at all — useful for UI iteration, never for recording the actual submission demo (the submission must show real Living Aion responses).

## What judges can inspect

- `server.js` — the entire real-request path: MCP session setup (`@modelcontextprotocol/sdk`'s own `Client`/`StreamableHTTPClientTransport`, the same package a genuine MCP host uses), the `ask_aion` call, and how the bearer token is kept server-side.
- `public/app.js` — the entire client-side path: confirms nothing but a question string ever leaves the browser, and nothing but response text ever comes back.
