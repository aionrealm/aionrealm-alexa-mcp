import { z } from "zod";

const MAX_QUESTION_LENGTH = 2000;

/**
 * Registers the single Phase 1 tool, ask_aion, on the given McpServer.
 *
 * This function contains no Aion logic itself: it validates shape only
 * (question present, reasonable length), delegates entirely to the given
 * adapter, and translates the adapter's result into an MCP tool result.
 * AionRealm's backend remains the sole source of truth for authentication,
 * Living Aion context, member data, safety rules, and response generation.
 *
 * Anonymous-MVP scope: the exposed schema intentionally accepts only
 * `question`. member_id/session_id were removed from the public MCP tool
 * schema -- this server has no account-linking/authenticated-member
 * capability yet, and exposing those fields would suggest a capability
 * that doesn't exist. The AionRealm backend contract itself is unchanged
 * (see httpAionAdapter.js): it still always sends member_id/session_id as
 * null, exactly as it did before -- only what this MCP tool accepts from
 * a *caller* changed, not what AionRealm receives.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("./adapters/httpAionAdapter.js").AionAdapter} adapter
 */
export function registerAskAionTool(server, adapter) {
  server.registerTool(
    "ask_aion",
    {
      title: "Ask Aion",
      description:
        "Ask AionRealm's Living Aion guide a question and receive Aion's response, " +
        "anonymously -- no AionRealm account or member context is used or required. " +
        "This tool only relays the question to AionRealm's own backend and returns Aion's " +
        "answer -- it does not generate, store, or interpret spiritual or member intelligence " +
        "itself; AionRealm remains authoritative for authentication, context, safety rules, " +
        "and response generation.",
      inputSchema: {
        question: z
          .string()
          .min(1, "question must not be empty")
          .max(
            MAX_QUESTION_LENGTH,
            `question must be ${MAX_QUESTION_LENGTH} characters or fewer`,
          )
          .describe("The caller's question for Aion, in natural language."),
      },
      annotations: {
        title: "Ask Aion",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ question }) => {
      try {
        const result = await adapter.askAion({ question });

        if (!result || typeof result.text !== "string" || !result.text.trim()) {
          throw new Error("Aion backend returned an empty response.");
        }

        return {
          content: [{ type: "text", text: result.text }],
        };
      } catch (error) {
        // Never leak adapter/network internals (URLs, stack traces, backend
        // error bodies) to the MCP client -- log server-side only.
        console.error("[ask_aion] backend call failed:", error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Aion could not be reached right now. Please try again in a moment.",
            },
          ],
        };
      }
    },
  );
}
