// Decides whether this process is allowed to start at all, and with what
// MCP_SERVER_AUTH_TOKEN. Fails closed by default: a deployable server must
// never silently become unauthenticated just because the token was left
// unset -- that would be a real-world way for a public deployment to end up
// wide open by omission (a blank env var, a missed secret, a bad rollout).
//
// The ONLY way to run without a token is the explicit, dedicated
// MCP_ALLOW_NO_AUTH=true flag. This is deliberately its own variable rather
// than being inferred from MOCK_AION_BACKEND or AION_BACKEND_URL being
// unset: those describe which Aion *backend adapter* to use, not whether
// this MCP server's own endpoint should be reachable without
// authentication. Conflating the two would mean, for example, a real
// AION_BACKEND_URL being misconfigured/unreachable could silently leave the
// MCP endpoint unauthenticated -- an unrelated failure mode should never
// change the auth posture.
//
// Kept as a small, pure, side-effect-free function (not baked into
// server.js's top-level script) specifically so it can be unit tested
// without spawning a process or starting a real server.

export class MissingAuthTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = "MissingAuthTokenError";
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null} the bearer token to require, or null if
 *   MCP_ALLOW_NO_AUTH=true was explicitly set (local development only).
 * @throws {MissingAuthTokenError} if no token is configured and
 *   MCP_ALLOW_NO_AUTH is not explicitly "true".
 */
export function resolveAuthToken(env = process.env) {
  const token = String(env.MCP_SERVER_AUTH_TOKEN ?? "").trim();
  if (token) return token;

  const explicitlyAllowed = String(env.MCP_ALLOW_NO_AUTH ?? "").toLowerCase() === "true";
  if (explicitlyAllowed) return null;

  throw new MissingAuthTokenError(
    "MCP_SERVER_AUTH_TOKEN is not set. A deployable server must not start " +
      "unauthenticated. For local development only, set MCP_ALLOW_NO_AUTH=true " +
      "explicitly (this must never be set in a public/production deployment).",
  );
}
