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
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("./adapters/httpAionAdapter.js").AionAdapter} adapter
 */
export function registerAskAionTool(server, adapter) {
  server.registerTool(
    "ask_aion",
    {
      title: "Ask Aion",
      description:
        "Ask AionRealm's Living Aion guide a question and receive Aion's response. " +
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
          .describe("The member's question for Aion, in natural language."),
        member_id: z
          .string()
          .optional()
          .describe(
            "Optional AionRealm member identifier, intended for once Alexa+ account " +
              "linking is added in a later phase. Omit for anonymous/guest questions. The " +
              "MCP layer passes this through unchanged; it does not look up or validate it.",
          ),
        session_id: z
          .string()
          .optional()
          .describe(
            "Optional conversation/session identifier from the calling surface (e.g. an " +
              "Alexa+ conversation turn), passed through unchanged so AionRealm can maintain " +
              "its own conversation context. The MCP layer does not interpret or store this.",
          ),
      },
      annotations: {
        title: "Ask Aion",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ question, member_id: memberId, session_id: sessionId }) => {
      try {
        const result = await adapter.askAion({ question, memberId, sessionId });

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
