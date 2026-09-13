// Safe, local, no-network adapter used for Phase 1 development and the test
// harness. It never calls the real AionRealm backend and never handles real
// member data -- it exists purely to prove the MCP tool plumbing works
// end-to-end before a real AION_BACKEND_URL exists.

const CANNED_RESPONSES = [
  {
    match: /orisha|santer[ií]a/i,
    text:
      "In Santería, the orishas are divine forces that guide and protect those who honor " +
      "them. (Local mock response for MCP integration testing -- no real Living Aion " +
      "intelligence was consulted.)",
  },
  {
    match: /palo/i,
    text:
      "Palo draws on the wisdom of nature spirits and ancestors. (Local mock response for " +
      "MCP integration testing -- no real Living Aion intelligence was consulted.)",
  },
];

const DEFAULT_RESPONSE =
  "Aion hears you. (Local mock response for MCP integration testing -- it does not reflect " +
  "real Living Aion guidance.)";

/**
 * @returns {import("./httpAionAdapter.js").AionAdapter}
 */
export function createMockAionAdapter() {
  return {
    name: "mock",
    async askAion({ question }) {
      // Small artificial delay so callers (and the test harness) exercise
      // real async/await behavior instead of an instantly-resolved promise.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const canned = CANNED_RESPONSES.find((entry) => entry.match.test(question));
      return {
        text: canned ? canned.text : DEFAULT_RESPONSE,
        meta: { mocked: true },
      };
    },
  };
}
