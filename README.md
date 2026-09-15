# AionRealm Alexa+ MCP Integration (Hackathon)

A standalone, self-hosted **Model Context Protocol (MCP)** server built for the Amazon
Developer Hackathon's Alexa+ integration track. It exposes a single tool, **`ask_aion`**,
that lets an MCP-compatible client (Alexa+, or any other MCP host) ask AionRealm's Living
Aion guide a question anonymously and get its response back.

This repository is intentionally separate from the main AionRealm production codebase. It
contains no AionRealm source code, no member data, and no spiritual-guidance logic of its
own — it is a thin, narrow relay. AionRealm's main application repository is, and remains,
private; nothing proprietary is duplicated here.

## What this is (and isn't)

- **Is:** an MCP server, speaking [Streamable HTTP](https://modelcontextprotocol.io/) (MCP
  spec 2025-11-25+), with one tool (`ask_aion`) that forwards a question to AionRealm's
  authenticated Alexa+ backend endpoint and returns Aion's answer.
- **Is not:** a copy of, or a proxy that duplicates, AionRealm's authentication, Living Aion
  context, member data, or safety-rule logic. AionRealm's own backend remains authoritative
  for all of that — this server only relays.
- **Anonymous MVP scope.** The exposed tool schema accepts only a `question` — no member
  identity, session, or account context of any kind. No ElevenLabs voice synthesis, no
  Alexa-specific simulation UI, no additional tools (bóveda actions, reflections, rituals,
  entity consultations, etc.), and no authenticated/member behavior. Those are explicitly out
  of scope for this server as it stands.

## Architecture

```
Alexa+ (or any MCP client)
        │  Streamable HTTP (JSON-RPC over HTTP, MCP spec 2025-11-25+),
        │  Authorization: Bearer <MCP_SERVER_AUTH_TOKEN>
        ▼
┌────────────────────────────────┐
│  This server (Express +        │
│  @modelcontextprotocol/sdk)    │
│                                 │
│  tool: ask_aion (question only)│
│    └─ AionAdapter interface    │──▶ mock adapter (local, no network — dev default)
│        (src/adapters/)         │──▶ HTTP adapter ──▶ AionRealm's authenticated
└────────────────────────────────┘        Alexa+ backend endpoint ──▶ Living Aion
```

In words: **Alexa+ → this standalone MCP server → AionRealm's authenticated Alexa backend
endpoint → Living Aion.** That backend endpoint now exists and is deployed in AionRealm's
Production environment — authenticating this MCP server as the caller (a dedicated,
narrow, revocable API key issued specifically for this integration, distinct from any member
credential), and internally calling into AionRealm's existing Living Aion pipeline exactly as
it does for every other surface. This repository has no visibility into, and makes no
assumptions about, how that pipeline works internally.

The **adapter interface** (`src/adapters/httpAionAdapter.js` — see the `AionAdapter` JSDoc
typedef at the top) is the only seam between this server and AionRealm. Nothing else in this
repo needs to change to point at a different AionRealm environment (local → staging →
production) — only the adapter's configuration (`AION_BACKEND_URL`, `AION_BACKEND_API_KEY`)
needs to change. Swapping the mock adapter out for the real one is likewise just an
environment-variable change (`MOCK_AION_BACKEND`). The real `AION_BACKEND_URL` and its
dedicated API key are operational secrets, set only in the deployment environment (e.g. AWS
App Runner's own secret store) — never committed here.

### Files

```
src/
  server.js                     entrypoint: loads .env, resolves auth, builds the app, listens
  app.js                        builds the Express app + MCP server + Streamable HTTP transport
  authConfig.js                 fail-closed MCP_SERVER_AUTH_TOKEN resolution (see below)
  mcpServer.js                  registers the ask_aion tool (input validation, no Aion logic)
  adapters/
    aionAdapter.js              factory: picks mock vs. HTTP adapter based on env vars
    mockAionAdapter.js          safe local adapter, no network calls, canned responses
    httpAionAdapter.js          real adapter: calls the AionRealm backend (contract below)
test/
  ask_aion.e2e.test.js          end-to-end proof: real MCP client, real HTTP, mock adapter
  auth.contract.test.js         timing-safe bearer-auth coverage
  authConfig.test.js            fail-closed auth-token resolution coverage
  healthz.contract.test.js      /healthz information-disclosure coverage
  ask_aion_schema.contract.test.js  anonymous-MVP schema coverage
.env.example                    documented list of every environment variable this reads
Dockerfile                      minimal Node 20 image for AWS App Runner (see "Deployment")
LICENSE                         MIT
```

## Deployment

A `Dockerfile` is included for the recommended smallest deployment path (AWS App Runner,
building this image directly). It uses a minimal Node 20 base image, installs only production
dependencies, and bakes in no secrets and no `.env` file — every variable in "Environment
variables" above is supplied at deploy time by the hosting platform's own environment/secret
configuration. Building or running the image locally does not itself deploy anything.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

With `AION_BACKEND_URL` left blank, the server automatically uses the built-in mock adapter —
no real AionRealm credentials are needed to run or test it locally. **Authentication is
mandatory by default**, though: this server refuses to start at all unless
`MCP_SERVER_AUTH_TOKEN` is set, or you explicitly opt out for local development by also
setting `MCP_ALLOW_NO_AUTH=true` (see "Environment variables" below) — `npm run dev` already
does this for you.

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

This runs every `test/*.test.js` file with Node's built-in test runner:

- **`ask_aion.e2e.test.js`** — a **real** end-to-end test: starts a real HTTP server (this
  repo's actual `src/app.js`, unmodified), connects a real MCP client (the same
  `@modelcontextprotocol/sdk` client package a genuine MCP host uses) over real Streamable
  HTTP, and drives it exactly as a client would — `listTools()`, `callTool(...)`, session
  lifecycle (independent sessions, idle expiry, the concurrent-session cap, graceful
  shutdown), and malformed/unknown-session handling. All against the safe mock adapter — no
  network calls, no real AionRealm backend involved.
- **`auth.contract.test.js`** — the timing-safe bearer-token comparison: valid, invalid,
  malformed, and missing `Authorization` headers, each rejected with a clean `401` and no
  internal detail leaked.
- **`authConfig.test.js`** — the fail-closed `MCP_SERVER_AUTH_TOKEN` resolution logic in
  isolation (no server involved): confirms it refuses to resolve without a token unless
  `MCP_ALLOW_NO_AUTH=true` is explicitly set, and that it is never fooled by an unrelated
  variable like `MOCK_AION_BACKEND` or `AION_BACKEND_URL`.
- **`healthz.contract.test.js`** — `/healthz` stays minimal and never leaks `AION_BACKEND_URL`
  or any other adapter/infrastructure detail, even from an adapter whose name embeds a URL,
  and even though the endpoint itself is intentionally unauthenticated.
- **`ask_aion_schema.contract.test.js`** — the exposed tool schema declares only `question`
  (no `member_id`/`session_id`), exactly one tool is registered, and the adapter always
  receives `member_id`/`session_id` as unset/null regardless of what a caller sends.

You can also smoke-test it manually against a running server with any MCP-compatible client,
or with `curl` for the raw JSON-RPC handshake (see "Protocol notes" below).

## Environment variables

See `.env.example` for the full, documented list. Summary:

| Variable | Purpose |
|---|---|
| `PORT` | Port this server listens on. |
| `MCP_PATH` | HTTP path the MCP endpoint is served at (default `/mcp`). |
| `MCP_SERVER_AUTH_TOKEN` | **Required** shared-secret bearer token for this server's own `/mcp` endpoint. The server refuses to start without it unless `MCP_ALLOW_NO_AUTH=true` is explicitly set. |
| `MCP_ALLOW_NO_AUTH` | Explicit, local-development-only opt-out of the token requirement above. Must be exactly `true`. Never set this in a public/production deployment. |
| `MOCK_AION_BACKEND` | `true` to force the local mock adapter regardless of other settings. |
| `AION_BACKEND_URL` | URL of AionRealm's authenticated Alexa backend endpoint. This now exists and is deployed in Production. Leave blank to use the local mock adapter. |
| `AION_BACKEND_API_KEY` | Dedicated, narrow, revocable MCP-integration API key for `AION_BACKEND_URL`. Never a member session token or the main repo's Supabase service-role key. |
| `AION_BACKEND_TIMEOUT_MS` | Timeout for calls to the AionRealm backend. |

**No production credentials are committed to this repository.** `.env` is gitignored;
`.env.example` contains only placeholder/blank values.

## Security boundaries

- Secrets live only in environment variables, never in source, and never in this repository's
  history.
- **`MCP_SERVER_AUTH_TOKEN` is mandatory.** The server fails closed at startup if it's unset —
  it will not silently come up unauthenticated. The only opt-out is the explicit
  `MCP_ALLOW_NO_AUTH=true` flag, for local development only; this is never inferred from
  `MOCK_AION_BACKEND` or `AION_BACKEND_URL`, since those describe which Aion backend adapter
  to use, not whether this server's own endpoint should require authentication. The bearer
  comparison itself is timing-safe (`crypto.timingSafeEqual`).
- `/healthz` is intentionally unauthenticated (needed for platform health checks, e.g. AWS App
  Runner) but is minimal by design: it returns only `{ status, service }` and never the
  backend URL, adapter identity, or any other infrastructure detail.
- `AION_BACKEND_API_KEY` is a separate concept from the token above: it's how *this server*
  authenticates to the *AionRealm backend*. It's a narrow, purpose-specific, revocable
  credential AionRealm issues specifically for this integration — never a reused member
  token, and never AionRealm's own Supabase service-role key.
- `ask_aion`'s exposed schema accepts only `question` — no member identity, session, or
  account context can be supplied by a caller. This server has no authenticated/member
  capability; it is anonymous-only end to end.
- The `express`/`qs` transitive advisory that previously affected this project's exact
  installed versions is resolved (see "Dependency advisory" below) — no unpatched moderate
  vulnerabilities remain as of the last `npm audit`.

## Public/private repository separation

This repository is the hackathon-facing, public-safe half of the Alexa+ integration. It
contains: this MCP server's own code, its tests, and documentation of the *shape* of the
contract it expects from AionRealm's backend. It deliberately does not contain: AionRealm's
application source code, its Living Aion implementation, member data, database schemas, or
any credential beyond documented, blank placeholders. AionRealm's main repository is, and
must remain, private; nothing here should ever require making it public.

## Dependency advisory

`express@4.x`'s transitive `qs` dependency previously carried two moderate-severity
advisories ([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx),
[GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)) at the exact
versions this project had installed (`qs@6.15.3` via `express@4.22.2`). Both are fixed in
`qs@6.16.0`, which `express@4.22.3` already depends on — a patch-level Express bump, already
within this project's existing `^4.21.2` range in `package.json`. `npm audit fix` resolved
both advisories with no `package.json` change and no code change; `npm audit` now reports
zero vulnerabilities. Express 5 was not necessary and was not adopted.

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

## AionRealm backend contract (implemented)

This server does not modify, and does not require any changes to, the main AionRealm
repository. The narrow backend endpoint `src/adapters/httpAionAdapter.js` calls **now exists
and is deployed** in AionRealm's Production environment. This section documents the wire
contract between this MCP server and that endpoint — it is a lower-level, internal contract
than `ask_aion`'s own MCP tool schema (which exposes only `question` to callers; see
"Security boundaries" above). This server's adapter always sends `member_id`/`session_id` as
`null` today, since the public MCP tool never collects them:

**Request** — `POST {AION_BACKEND_URL}`
```json
{
  "question": "string, required",
  "member_id": null,
  "session_id": null,
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

On the AionRealm side, this endpoint:
- Authenticates the request via a **dedicated, narrow, revocable** API key issued specifically
  for this MCP integration (not a member session token, not the Supabase service-role key).
- Internally calls into AionRealm's existing Living Aion response pipeline — this MCP server
  has no opinion on how that happens, only on the request/response shape above.
- Applies AionRealm's own safety rules and response generation exactly as it does for other
  anonymous surfaces (no member-context lookup occurs today, since `member_id` is always
  `null`).
- Returns errors as `{ "error": "message" }` with a non-2xx status; the adapter surfaces a
  generic "Aion could not be reached" message to the MCP caller and logs the real error
  server-side only, so backend error details never leak to the calling client.

Everything else (Alexa+ account linking, member-context `ask_aion` fields, ElevenLabs voice,
additional MCP tools, an Alexa simulator) is out of scope for this server as it stands and is
intentionally not started here.
