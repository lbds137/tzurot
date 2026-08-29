---
id: TASK-826
title: >-
  Footer cannot mark a router-resolved turn — routedModel never reaches
  bot-client
status: To Do
assignee: []
created_date: '2026-08-29 21:03'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 826000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-817 case 2 (a router alias like openrouter/auto resolving to a concrete model should read as "routed", not as a failure arrow) cannot be built in bot-client today. TASK-817 assumed routedModel became available when it shipped, but it landed on the DIAGNOSTIC path only: it is declared on DiagnosticPayload (packages/common-types/src/types/diagnostic.ts:301) and produced in ai-worker (services/ai-worker/src/services/LLMInvoker.ts:680, from response_metadata.openrouter.model). Verified absent from the delivery path: grep for routedModel across services/bot-client returned EMPTY. The footer is built at packages/common-types/src/constants/discord.ts:442 from a single call site, services/bot-client/src/services/DiscordResponseSender.ts:276, whose quotaFallback comes from the job-result metadata.

Wire-schema hazard, the reason this is not a one-line thread: the generation result is Zod-parsed at packages/common-types/src/types/schemas/generation.ts:164. A response key not declared there is stripped before any caller sees it, and a mocked client skips the parse, so a unit test can pass while the field never arrives in production. Pin survival at the boundary with a safeParse of a sentinel payload.

Fix shape: declare routedModel on the generation result schema beside quotaFallback; populate it in ai-worker where the result metadata is assembled; thread it through the job result to DiscordResponseSender; add a routing arm to buildModelFooterText rendering "Model: <alias> -> [<routed>](<url>) (routed)".

Vocabulary is SETTLED, do not re-decide: the owner chose "routed" (not "autorouted") against rendered previews on 2026-08-29, and /inspect uses the same word. Drift here becomes drift between two user-facing surfaces.

Acceptance: a router-resolved turn renders the alias, the concrete model, and the shorthand "(routed)"; a genuine fallback still renders its arrow plus parenthetical reason; a free-tier structural substitution still renders no arrow at all; the routedModel key is proven to survive the generation wire schema by a safeParse test, not only by a mocked-client unit test.
<!-- SECTION:DESCRIPTION:END -->
