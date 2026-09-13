// Real adapter: calls a narrow AionRealm backend endpoint. This endpoint
// does not exist in the main AionRealm repo yet -- see README.md "What
// Phase 2 needs from the AionRealm repo" for the exact contract this
// adapter expects the backend to implement.
//
// This file intentionally contains no Aion logic, no prompt construction,
// no safety rules, and no member-data handling of its own -- it only
// relays a question and a couple of pass-through identifiers, and expects
// back a plain { text } response that AionRealm has already fully composed
// and safety-checked.

/**
 * @typedef {Object} AionAdapter
 * @property {string} name
 * @property {(input: { question: string, memberId?: string, sessionId?: string }) => Promise<{ text: string, meta?: Record<string, unknown> }>} askAion
 */

/**
 * @param {{ baseUrl: string, apiKey: string, timeoutMs?: number }} config
 * @returns {AionAdapter}
 */
export function createHttpAionAdapter({ baseUrl, apiKey, timeoutMs = 15000 }) {
  if (!baseUrl) {
    throw new Error(
      "AION_BACKEND_URL is required to use the HTTP Aion adapter. Set MOCK_AION_BACKEND=true " +
        "to use the local mock adapter instead.",
    );
  }
  if (!apiKey) {
    throw new Error(
      "AION_BACKEND_API_KEY is required to use the HTTP Aion adapter. This must be a " +
        "dedicated, narrow, revocable MCP-integration key issued by AionRealm -- never a " +
        "member session token and never the AionRealm repo's Supabase service-role key.",
    );
  }

  return {
    name: `http(${baseUrl})`,

    async askAion({ question, memberId, sessionId }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response;
        try {
          response = await fetch(baseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              question,
              member_id: memberId ?? null,
              session_id: sessionId ?? null,
              surface: "alexa_mcp",
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error?.name === "AbortError") {
            throw new Error(`AionRealm backend did not respond within ${timeoutMs}ms.`);
          }
          throw new Error(`Could not reach AionRealm backend: ${error.message}`);
        }

        const rawBody = await response.text();
        let data;
        try {
          data = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          throw new Error(
            `AionRealm backend returned a non-JSON response (HTTP ${response.status}).`,
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.error || `AionRealm backend returned HTTP ${response.status}.`,
          );
        }

        if (typeof data.text !== "string" || !data.text.trim()) {
          throw new Error("AionRealm backend response did not include a non-empty text field.");
        }

        return { text: data.text, meta: data.meta };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
