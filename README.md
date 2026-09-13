# AionRealm Alexa+ MCP Integration (Hackathon — Phase 1)

A standalone, self-hosted **Model Context Protocol (MCP)** server built for the Amazon
Developer Hackathon's Alexa+ integration track. It exposes a single tool, **`ask_aion`**,
that lets an MCP-compatible client (eventually Alexa+) ask AionRealm's Living Aion guide a
question and get its response back.

This repository is intentionally separate from the main AionRealm production codebase. It
contains no AionRealm source code, no member data, and no spiritual-guidance logic of its
own — it is a thin, narrow relay.

## What this is (and isn't)

- **Is:** an MCP server, speaking [Streamable HTTP](https://modelcontextprotocol.io/) (MCP
  spec 2025-11-25+), with one tool (`ask_aion`) that forwards a question to an AionRealm
  backend adapter and returns the answer.
- **Is not:** a copy of, or a proxy that duplicates, AionRealm's authentication, Living Aion
  context, member data, or safety-rule logic. AionRealm's own backend remains authoritative
  for all of that — this server only relays.
- **Phase 1 scope only.** No ElevenLabs voice synthesis, no Alexa-specific simulation UI, no
  additional tools (bóveda actions, reflections, rituals, entity consultations, etc.). Those
  are explicitly deferred to later phases.

## Architecture

```
Alexa+ (or any MCP client)
        │  Streamable HTTP (JSON-RPC over HTTP, MCP spec 2025-11-25+)
        ▼
┌───────────────────────────────┐
│   This server (Express +      │
│   @modelcontextprotocol/sdk)  │
│                                │
│   tool: ask_aion               │
│     └─ AionAdapter interface   │──▶ mock adapter (local, no network — default)
│         (src/adapters/)        │──▶ HTTP adapter ──▶ AionRealm backend (Phase 2)
└───────────────────────────────┘
```

The **adapter interface** (`src/adapters/httpAionAdapter.js` — see the `AionAdapter` JSDoc
typedef at the top) is the only seam between this server and AionRealm. Nothing else in this
repo needs to change to point at a different AionRealm environment (local → staging →
production) — only the adapter's configuration (`AION_BACKEND_URL`, `AION_BACKEND_API_KEY`)
needs to change. Swapping the mock adapter out for the real one is likewise just an
environment-variable change (`MOCK_AION_BACKEND`).

### Files

```
src/
  server.js                     entrypoint: loads .env, builds the app, starts listening
  app.js                        builds the Express app + MCP server + Streamable HTTP transport
  mcpServer.js                  registers the ask_aion tool (input validation, no Aion logic)
  adapters/
    aionAdapter.js              factory: picks mock vs. HTTP adapter based on env vars
    mockAionAdapter.js          safe local adapter, no network calls, canned responses
    httpAionAdapter.js          real adapter: calls the AionRealm backend (Phase 2 contract below)
test/
  ask_aion.e2e.test.js          end-to-end proof: real MCP client, real HTTP, mock adapter
.env.example                    documented list of every environment variable this reads
```

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

The defaults in `.env.example` are safe for local development out of the box: with
`AION_BACKEND_URL` left blank, the server automatically uses the built-in mock adapter — no
real AionRealm credentials are needed to run or test this Phase 1 server.

## Running it

```bash
npm start
```

This starts the MCP server (default `http://localhost:3333/mcp`) and a plain health check at
`http://localhost:3333/healthz`.

```bash
npm run dev
```

Same as `npm start`, but forces the mock adapter on regardless of `.env` (useful when you
have a real `AION_BACKEND_URL` configured for other purposes but want to iterate locally
without hitting it).

## Testing

```bash
npm test
```

This runs `test/ask_aion.e2e.test.js`, which is a **real** end-to-end test: it starts a real
HTTP server (this repo's actual `src/app.js`, unmodified), connects a real MCP client (the
same `@modelcontextprotocol/sdk` client package a genuine MCP host uses) to it over real
Streamable HTTP, and drives it exactly as a client would — `listTools()`, then
`callTool({ name: "ask_aion", ... })` — all against the safe mock adapter. It also covers
input validation (empty question) and the optional bearer-token auth gate. No network calls
occur and no real AionRealm backend is involved.

You can also smoke-test it manually against a running server with any MCP-compatible client,
or with `curl` for the raw JSON-RPC handshake (see "Protocol notes" below).

## Environment variables

See `.env.example` for the full, documented list. Summary:

| Variable | Purpose |
|---|---|
| `PORT` | Port this server listens on. |
| `MCP_PATH` | HTTP path the MCP endpoint is served at (default `/mcp`). |
| `MCP_SERVER_AUTH_TOKEN` | Optional shared-secret bearer token required to reach this server itself. Leave unset for local dev; set before exposing publicly. |
| `MOCK_AION_BACKEND` | `true` to force the local mock adapter regardless of other settings. |
| `AION_BACKEND_URL` | URL of the AionRealm backend adapter endpoint (Phase 2 — does not exist yet). |
| `AION_BACKEND_API_KEY` | Dedicated, narrow, revocable MCP-integration API key for `AION_BACKEND_URL`. Never a member session token or the main repo's Supabase service-role key. |
| `AION_BACKEND_TIMEOUT_MS` | Timeout for calls to the AionRealm backend. |

**No production credentials are committed to this repository.** `.env` is gitignored;
`.env.example` contains only placeholder/blank values.

## Security notes

- Secrets live only in environment variables, never in source.
- `MCP_SERVER_AUTH_TOKEN` gates this server's own `/mcp` endpoint. It's optional for local
  development but **should be set before this server is exposed to the public internet** (e.g.
  once a real Alexa+ integration needs to reach it), so arbitrary internet traffic can't
  invoke `ask_aion` and rack up AionRealm backend calls.
- `AION_BACKEND_API_KEY` is a separate concept: it's how *this server* authenticates to the
  *AionRealm backend*. It should be a narrow, purpose-specific, revocable credential that
  AionRealm issues specifically for this integration — not a reused member token or admin
  credential.
- A known moderate-severity transitive advisory exists in `express@4.x`'s `qs` dependency
  (query-string DoS). Not a practical concern for a local/dev server with no public query-string
  surface in Phase 1, but worth revisiting (likely an Express major-version bump) before any
  public-facing deployment.

## Protocol notes

- This server implements **Streamable HTTP** per MCP spec 2025-11-25+, using
  `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`.
- It runs in **stateful** mode (the server issues a session ID on `initialize`, sent back via
  the `mcp-session-id` header and required on subsequent requests). This is the transport's
  primary/well-supported mode. Stateless mode (`sessionIdGenerator: undefined`) was tried
  first, since Phase 1 only needs one request/response tool — but in the SDK version pinned
  here (`@modelcontextprotocol/sdk@^1.30.0`), the standard post-initialize
  `notifications/initialized` message fails with an unsurfaced HTTP 500 in stateless mode.
  Stateful mode was verified to handle the same handshake correctly and is otherwise
  functionally equivalent for a single-tool server like this one — from `ask_aion`'s
  perspective, each call is still a single independent request.
- `ask_aion` calls are read-only / non-destructive (declared via `annotations.readOnlyHint`
  and `destructiveHint` on the tool registration) and are marked non-idempotent (each call may
  produce a different Aion response) and open-world (backend is external).

## What Phase 2 needs from the AionRealm repo

This server does not modify, and Phase 1 does not require any changes to, the main AionRealm
repository. To move from the mock adapter to the real one, AionRealm needs one new, narrow
backend endpoint matching the contract `src/adapters/httpAionAdapter.js` already expects:

**Request** — `POST {AION_BACKEND_URL}`
```json
{
  "question": "string, required",
  "member_id": "string or null — pass-through only, not interpreted by the MCP layer",
  "session_id": "string or null — pass-through only, not interpreted by the MCP layer",
  "surface": "alexa_mcp"
}
```
Headers: `Authorization: Bearer <AION_BACKEND_API_KEY>`, `Content-Type: application/json`.

**Response** — `200 OK`
```json
{
  "text": "Aion's fully-composed, safety-checked response as plain text.",
  "meta": { "...": "optional, opaque to this MCP server" }
}
```

On the AionRealm side, this endpoint should:
- Authenticate the request via a **dedicated, narrow, revocable** API key issued specifically
  for this MCP integration (not a member session token, not the Supabase service-role key).
- Internally call into AionRealm's existing Living Aion / Sacred Guide response pipeline —
  this MCP server has no opinion on how that happens, only on the request/response shape above.
- Apply AionRealm's own safety rules, member-context lookups (if `member_id` is present and
  account linking has been implemented), and response generation exactly as it already does
  for other surfaces.
- Return errors as `{ "error": "message" }` with a non-2xx status; the adapter surfaces a
  generic "Aion could not be reached" message to the MCP caller and logs the real error
  server-side only, so backend error details never leak to the calling client.

Everything else (Alexa+ account linking, ElevenLabs voice, additional MCP tools, an Alexa
simulator) is out of scope for Phase 1 and intentionally not started here.
