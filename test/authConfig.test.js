// Coverage for the fail-closed MCP_SERVER_AUTH_TOKEN resolution in
// authConfig.js. A deployable server must never silently start
// unauthenticated just because the token is absent, and the escape hatch
// for local development must be its own explicit variable -- never
// inferred from an unrelated one (MOCK_AION_BACKEND, AION_BACKEND_URL).
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveAuthToken, MissingAuthTokenError } from "../src/authConfig.js";

test("throws when MCP_SERVER_AUTH_TOKEN is unset and MCP_ALLOW_NO_AUTH is unset", () => {
  assert.throws(() => resolveAuthToken({}), MissingAuthTokenError);
});

test("throws when MCP_SERVER_AUTH_TOKEN is blank/whitespace-only, even if present", () => {
  assert.throws(
    () => resolveAuthToken({ MCP_SERVER_AUTH_TOKEN: "   " }),
    MissingAuthTokenError,
  );
});

test("throws when MCP_ALLOW_NO_AUTH is set to anything other than the word 'true' (any case)", () => {
  for (const value of ["1", "yes", "TRUE ", " true", "false", ""]) {
    assert.throws(
      () => resolveAuthToken({ MCP_ALLOW_NO_AUTH: value }),
      MissingAuthTokenError,
      `MCP_ALLOW_NO_AUTH=${JSON.stringify(value)} must not be treated as an opt-in`,
    );
  }
  // The exact word "true", any case, with no surrounding whitespace, is
  // accepted -- see the next test.
});

test("does not fail closed when MCP_ALLOW_NO_AUTH is exactly 'true' (any case)", () => {
  assert.equal(resolveAuthToken({ MCP_ALLOW_NO_AUTH: "true" }), null);
  assert.equal(resolveAuthToken({ MCP_ALLOW_NO_AUTH: "TRUE" }), null);
});

test("returns the trimmed token when MCP_SERVER_AUTH_TOKEN is set", () => {
  assert.equal(
    resolveAuthToken({ MCP_SERVER_AUTH_TOKEN: "  my-secret  " }),
    "my-secret",
  );
});

test("a configured token always wins, regardless of MCP_ALLOW_NO_AUTH", () => {
  assert.equal(
    resolveAuthToken({ MCP_SERVER_AUTH_TOKEN: "my-secret", MCP_ALLOW_NO_AUTH: "true" }),
    "my-secret",
  );
});

test("does not infer an unauthenticated posture from MOCK_AION_BACKEND or a missing AION_BACKEND_URL", () => {
  // This is the specific anti-pattern being guarded against: neither of
  // these unrelated adapter-selection variables may substitute for the
  // explicit MCP_ALLOW_NO_AUTH opt-in.
  assert.throws(
    () => resolveAuthToken({ MOCK_AION_BACKEND: "true" }),
    MissingAuthTokenError,
  );
  assert.throws(
    () => resolveAuthToken({ AION_BACKEND_URL: "" }),
    MissingAuthTokenError,
  );
  assert.throws(
    () =>
      resolveAuthToken({
        MOCK_AION_BACKEND: "true",
        AION_BACKEND_URL: "",
        AION_BACKEND_API_KEY: "",
      }),
    MissingAuthTokenError,
  );
});

test("a real AION_BACKEND_URL being configured does not itself satisfy the auth requirement", () => {
  assert.throws(
    () =>
      resolveAuthToken({
        AION_BACKEND_URL: "https://example.invalid/aion",
        AION_BACKEND_API_KEY: "some-key",
      }),
    MissingAuthTokenError,
  );
});
