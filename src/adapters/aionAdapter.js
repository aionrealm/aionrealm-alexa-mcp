// Adapter interface (documented here, not enforced by TypeScript since this
// project is plain JS for Phase 1 -- keep implementations conforming by hand):
//
//   interface AionAdapter {
//     name: string;
//     askAion(input: {
//       question: string;
//       memberId?: string;
//       sessionId?: string;
//     }): Promise<{ text: string; meta?: Record<string, unknown> }>;
//   }
//
// mcpServer.js only ever talks to this interface. Swapping which AionRealm
// environment this server points at (local -> staging -> production), or
// swapping the mock adapter out for the real one, should never require
// touching mcpServer.js or the ask_aion tool definition.

import { createHttpAionAdapter } from "./httpAionAdapter.js";
import { createMockAionAdapter } from "./mockAionAdapter.js";

/**
 * Builds the AionAdapter this server should use, based on environment
 * configuration. Defaults to the mock adapter whenever AION_BACKEND_URL is
 * not set, so a fresh checkout with no configuration "just works" for local
 * testing instead of crashing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import("./httpAionAdapter.js").AionAdapter}
 */
export function createAionAdapter(env = process.env) {
  const explicitlyMocked = String(env.MOCK_AION_BACKEND).toLowerCase() === "true";
  const noBackendConfigured = !env.AION_BACKEND_URL;

  if (explicitlyMocked || noBackendConfigured) {
    return createMockAionAdapter();
  }

  return createHttpAionAdapter({
    baseUrl: env.AION_BACKEND_URL,
    apiKey: env.AION_BACKEND_API_KEY,
    timeoutMs: Number(env.AION_BACKEND_TIMEOUT_MS) || 15000,
  });
}
