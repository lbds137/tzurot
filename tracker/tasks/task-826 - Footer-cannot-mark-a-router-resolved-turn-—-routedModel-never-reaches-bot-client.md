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

CORRECTION to this task's own filing (2026-08-29, verified at build time): the "wire-schema hazard" originally stated here was WRONG. It claimed the generation result is Zod-parsed and that an undeclared key is "stripped before any caller sees it". llmGenerationResultSchema is never .parse()d or .safeParse()d in production code — grep for llmGenerationResultSchema and generationPayloadSchema across packages/ and services/ (excluding dist/ and *.test.ts) returns only the definition, the z.infer type export, and doc-comment mentions. bot-client reads the result at services/bot-client/src/services/ResultsListener.ts:202 via JSON.parse(...) as LLMGenerationResult — a CAST, not a parse. There is no runtime strip. The field must still be declared on the schema, but for a different reason: LLMGenerationResult is inferred from it, so an undeclared field is a COMPILE error at every read site. The safeParse test in the acceptance below is still worth having — it pins the DECLARATION, which the inferred type and every read site depend on.

Two further build-time findings the original filing did not have. (1) readRoutedModel already exists at services/ai-worker/src/services/multimodal/readRoutedModel.ts:18, unit-tested and canary-pinned; it reads metadata.model_name, which @langchain/openai's converter populates unconditionally, giving it strictly wider coverage than the response_metadata.openrouter.model read at LLMInvoker.ts:680 (that one is gated on expectsRawResponse). Use the existing primitive; do not write a second extraction. (2) services/bot-client/src/utils/resultMetadataPassthrough.ts claims in its docstring to be spread at every success-path call site so a new metadata field cannot reach one delivery path but not the others — that claim is currently false: only MessageHandler.ts imports it, while SlotDeliveryService.ts:122 (inside deliverSuccess) hand-builds the same 11 fields inline. Adding the field to the helper alone would produce exactly the divergence the docstring says is impossible.

Composition rule settled at build time: the routing arm fires ONLY when quotaFallback is undefined. A genuine fallback and a guest-mode substitution each already own the footer's model line and both renderings were owner-approved in PR #2255; adding routing on top would either contradict the approved guest-mode no-arrow rule or bury a genuine incident. The overlapping case is fully attributed on /inspect, which renders Requested/Served/Routed as separate lines.

Fix shape: declare routedModel on the generation result schema beside modelUsed; populate it in ai-worker via readRoutedModel where the RAG response is assembled; thread it through GenerationStep result metadata, the passthrough helper, and DiscordResponseSender; consolidate the SlotDeliveryService success-path site onto the helper; add a routing arm to buildModelFooterText rendering "Model: <alias> -> [<routed>](<url>) (routed)".

Vocabulary is SETTLED, do not re-decide: the owner chose "routed" (not "autorouted") against rendered previews on 2026-08-29, and /inspect uses the same word. Drift here becomes drift between two user-facing surfaces.

Acceptance: a router-resolved turn renders the alias, the concrete model, and the shorthand "(routed)"; a genuine fallback still renders its arrow plus parenthetical reason; a free-tier structural substitution still renders no arrow at all; the routedModel key is proven to survive the generation wire schema by a safeParse test, not only by a mocked-client unit test.
<!-- SECTION:DESCRIPTION:END -->
