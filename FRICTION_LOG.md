# Friction Log — AionRealm Alexa+ MCP Integration

Genuine developer-experience friction encountered while building and deploying this project
during the Amazon Developer Hackathon (Alexa+ track). Scoped to Amazon/AWS/Alexa+ tooling and
documentation only — this is not a general project changelog, and it excludes friction
unrelated to Amazon/AWS (e.g. issues in AionRealm's own unrelated infrastructure that had
nothing to do with this integration).

Each entry reflects something actually encountered while doing the work in this repository and
its live AWS deployment — nothing here is hypothetical or exaggerated for effect.

---

## 1. Alexa+ MCP Toolkit / Alexa AI CLI access is partner-gated — discovered after building to spec

**Task attempted:** Register the completed, spec-compliant MCP server as an Alexa+ add-on and
validate it in the Alexa+ development simulator.

**Steps taken:** Built the MCP server fully to the documented MCP 2025-11-25 / Streamable HTTP
spec, deployed it live on AWS App Runner, and verified `initialize`, `tools/list`, and a real
`ask_aion` call all work correctly. Only then searched the official Alexa+ Builder documentation
(`developer.amazon.com/docs/alexaplus/...`) for the onboarding/registration steps.

**Expected result:** A self-service (or at least documented, request-able) path to install the
Alexa AI CLI, authenticate, and register the add-on for simulator testing.

**Actual result:** The documentation states plainly: *"Category SDK and MCP Toolkit are
available to select partners only... Alexa+ for Builders is currently available to select
partners working directly with our team."* There is no public self-service signup path
documented anywhere in the developer docs we could find.

**Severity:** Critical — this is the single blocker preventing real Alexa+ simulator/device
validation of an otherwise fully working, spec-compliant integration.

**Workaround:** Sent a partner-access request to Amazon/hackathon support, and built a clearly
labeled, self-hosted "simulated Alexa+ device" demo front end that exercises the real, live MCP
server exactly as Alexa+ would (real MCP session, real `ask_aion` call, real response) — so the
submission can demonstrate genuine backend functionality even without simulator access.

**Actionable suggestion:** Offer hackathon entrants a time-boxed allowlist for MCP Toolkit access
for the duration of the event, ideally discoverable *before* a team invests in building a fully
spec-compliant server, not after.

---

## 2. Ambiguous OAuth requirement for a purely anonymous MCP tool

**Task attempted:** Determine whether our anonymous-only `ask_aion` tool (no member identity, no
account linking) needs to implement OAuth 2.1 + PKCE before it can work with Alexa+ at all.

**Steps taken:** Read the Alexa+ MCP QuickStart Guide's authentication section, and separately
the Account-Linking-for-MCP-Add-ons documentation.

**Expected result:** A clear statement of whether OAuth/PKCE is mandatory for every add-on
regardless of whether any tool needs member identity, or whether it's conditional.

**Actual result:** The two pages read differently. The QuickStart guide states self-hosted
servers must "return 401 for unauthenticated requests, implement OAuth 2.1 with PKCE (S256), and
host Protected Resource Metadata at `/.well-known/oauth-authorization-server`" in a way that
reads as a blanket requirement. The Account Linking documentation describes the same mechanism as
triggered *per tool, on demand* — Alexa calls a tool, and only if *that* tool needs auth does
your server return 401/403 and Alexa initiate the linking flow. These aren't fully reconcilable
from the public docs alone.

**Severity:** Important — this genuinely gates whether shipping an anonymous-only add-on requires
building a full OAuth 2.1 authorization server first, or not at all.

**Workaround:** Treated it as unresolved rather than guessing, and did not implement OAuth/PKCE
speculatively. Included this exact question in our Amazon partner-access request instead of
building against an assumption.

**Actionable suggestion:** One explicit line in the QuickStart guide — "OAuth/PKCE is only
required for tools that return 401/403; a fully anonymous add-on needs no account-linking
implementation" (or the opposite, if that's wrong) — would remove this ambiguity entirely.

---

## 3. Ambiguous scope of the documented <500ms latency target

**Task attempted:** Assess whether our `ask_aion` tool (which calls a real LLM through AionRealm's
existing backend) can meet Alexa+'s stated performance expectations.

**Steps taken:** Read the latency guidance in the MCP QuickStart Guide; separately measured our
own live `ask_aion` call's real round-trip time.

**Expected result:** A clear statement of what the ~500ms figure is measured against — full tool
execution (including any backend LLM call the tool makes) vs. transport/handshake latency only.

**Actual result:** The documentation states a "sub-500ms round-trip latency" target without
specifying which of those two things it means. Our own measured `ask_aion` call took between
4.1s and 7.8s across two independent real end-to-end tests — 8-16x over that figure, if it
applies to full tool execution.

**Severity:** Important — this materially affects whether our current synchronous
LLM-call-per-tool-call architecture is viable for Alexa+ as-is, or needs an async/streaming
redesign.

**Workaround:** None implemented yet — deliberately did not build latency workarounds (caching,
async patterns, a "let me check" filler response) against an unconfirmed requirement. Included
this as an explicit question in the Amazon partner-access request.

**Actionable suggestion:** Clarify in the docs whether the 500ms figure covers full tool
execution or only the MCP transport layer, and if it's the former, document the expected UX
pattern for tools that call a real LLM/backend (e.g. streaming partial results, or an
Alexa-native "thinking" indicator) rather than leaving it as a single unqualified number.

---

## 4. `iam:PassRole` troubleshooting: distinguishing role trust from pass-role authorization

**Task attempted:** Grant a narrowly-scoped, non-root IAM deploy user permission to attach a
purpose-built instance role to an App Runner service, without granting it broad IAM access.

**Steps taken:** Created the instance role and its trust policy (principal
`tasks.apprunner.amazonaws.com`). Attempted `apprunner create-service`; it failed with
`AccessDeniedException: ... not authorized to perform: iam:PassRole on resource:
arn:aws:iam::<account>:role/AppRunnerInstanceRole-... because no identity-based policy allows
the iam:PassRole action`. Added an `iam:PassRole` `Allow` statement scoped to that exact role
ARN, with a `Condition` requiring `"iam:PassedToService": "apprunner.amazonaws.com"` (matching
what AWS's own `AWSAppRunnerFullAccess` managed policy uses). Retried — **identical error**, four
times in a row across separate policy edits, with no way to distinguish "the edit didn't take
effect" from "the edit is wrong" (the IAM user itself lacked `iam:ListAttachedUserPolicies`,
`iam:SimulatePrincipalPolicy`, and every other IAM introspection permission, so it could not
self-diagnose its own policy at all). Root cause, found only by removing the condition entirely
to eliminate it as a variable: App Runner's actual `iam:PassedToService` context value for an
**instance role** is `tasks.apprunner.amazonaws.com` — not the bare `apprunner.amazonaws.com`
used in AWS's own commonly-referenced managed policy pattern for this exact use case.

**Expected result:** A policy granting `iam:PassRole` on the correct role ARN, scoped with the
condition pattern documented/implied by AWS's own tooling, should work on the first attempt.

**Actual result:** Four consecutive identical `AccessDeniedException`s with no way to tell,
from the error message alone, that the blocker was a condition-value mismatch rather than a
missing/misapplied policy — compounded by the IAM user having no permission to inspect or
simulate its own effective policy.

**Severity:** Important — this alone accounted for a disproportionate share of total AWS
deployment time, entirely due to error-message ambiguity, not actual infrastructure complexity.

**Workaround:** Removed the `iam:PassedToService` condition entirely (scoping remained tight via
the resource ARN alone), which succeeded immediately once the deployment proceeded past it,
confirming the condition value — not the underlying grant — was the problem.

**Actionable suggestion:** Two independent fixes would help: (1) AWS Support/IAM documentation
could explicitly state the correct `iam:PassedToService` value for each App Runner role type
(instance vs. access role) next to the actual `CreateService` API reference, not only in
separate IAM policy examples; (2) `iam:PassRole` `AccessDeniedException` messages could
distinguish "no matching statement at all" from "a statement exists but its condition didn't
match" — the current message is identical for both, which made this took much longer to
diagnose than the actual fix.

---

## 5. App Runner's GitHub source connection requires an interactive, human-only console step

**Task attempted:** Fully automate MCP server deployment to App Runner from the public GitHub
repository via the AWS CLI, without any manual console interaction.

**Steps taken:** Ran `apprunner create-connection --provider-type GITHUB` via the CLI. It
succeeded and returned a connection resource — but in `PENDING_HANDSHAKE` status, with the CLI's
own help text noting: *"Both require a user interface approval process through the App Runner
console before you can use the connection."*

**Expected result:** Either a fully CLI/API-completable connection flow, or an early, explicit
statement that this step cannot be automated.

**Actual result:** The connection could not be used for `CreateService` until a human opened the
App Runner console, found the pending connection, and completed an interactive GitHub OAuth-style
authorization step there — this is a hard requirement of the platform's GitHub integration, not
something we chose to route around.

**Severity:** Minor — one-time, quick to complete once identified, but it did block end-to-end
CLI automation and required a context-switch to the AWS web console mid-deployment.

**Workaround:** None needed beyond doing the one console click — documented here purely as a
known, unavoidable manual step for anyone else automating this.

**Actionable suggestion:** State this requirement explicitly and early in the `create-connection`
CLI's own primary help text (not only in a caveat line), and/or offer a CLI command to check
connection status with a direct deep-link URL to the exact console page needed, so it's
immediately actionable rather than requiring separate console navigation.

---

## 6. First-time AWS tooling setup friction (CLI, container tooling, runtime versions)

**Task attempted:** Stand up this project's first-ever AWS deployment from a fresh local
environment.

**Steps taken / actual results, briefly (each individually minor, listed together as a genuine
pattern rather than one isolated incident):**
- The AWS CLI was not pre-installed or on `PATH`; after installing it, a fresh terminal session
  still needed the full binary path (`C:\Program Files\Amazon\AWSCLIV2\aws.exe`) rather than
  picking up the updated `PATH` automatically.
- Docker was not installed locally and the deploy IAM user had no ECR permissions, which made
  the container/ECR deployment path (our own `Dockerfile`, included in the repo as an
  alternative) unusable from this environment — we pivoted to App Runner's native GitHub
  source-code build instead, which turned out to need no local Docker/ECR at all.
- `apprunner create-service` rejected our first attempt with
  `Value 'NODEJS_20' ... failed to satisfy constraint: Member must satisfy enum value set:
  [..., NODEJS_18, ..., NODEJS_22]` — App Runner's managed Node runtime list skips version 20
  entirely, despite Node 20 being a current, actively-supported LTS release and our own
  `package.json` engines field requiring `>=20`.

**Severity:** Minor individually; worth reporting collectively as first-run friction that likely
affects most new App Runner users on a fresh machine.

**Workaround:** Used the full binary path for the AWS CLI; used App Runner's source-code build
path instead of the Dockerfile/ECR path; used `NODEJS_22` (the closest supported runtime
satisfying our own `>=20` requirement) instead of `NODEJS_20`.

**Actionable suggestion:** Add Node 20 to the supported App Runner managed runtime list (or
clearly document why it's intentionally excluded), and have the CLI installer prompt/verify
`PATH` propagation before first use rather than silently leaving a stale `PATH`.
