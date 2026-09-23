---
id: TASK-1040
title: >-
  Diagnostic row provider should record the effective serving provider, as the
  usage row already does
status: Done
assignee: []
created_date: '2026-09-21 21:19'
updated_date: '2026-09-23 03:22'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1034000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 4 on PR #2468 (the /inspect estimated-cost line), mechanism verified in the main loop. The llm_diagnostic_logs provider column is written from the auth step resolution (services/ai-worker/src/jobs/handlers/LLMGenerationHandler.ts, grep provider: context.auth?.provider), while the provider that actually served the call after an auto-promotion or quota fallback (services/ai-worker/src/jobs/handlers/pipeline/steps/autoPromotionFallback.ts and quotaFallbackRunner.ts, grep effectiveProviderUsed: AIProvider.OpenRouter) reaches only the usage row (GenerationStep.ts, grep providerUsed: effectiveProviderUsed ?? provider). Consumers that gate on the diagnostic row provider - the cost estimate in services/api-gateway/src/services/diagnosticCost.ts gates on AIProvider.OpenRouter - therefore miss a promoted-then-fallen-back request that OpenRouter served: it is priceable and renders no cost line. Present behavior fails safe (null, never a wrong figure), which is why this is filed rather than patched in #2468; dropping the gate for catalog membership was declined there because a z.ai coding-plan request whose model also exists in the OpenRouter catalog would be priced at OpenRouter list price.
Fix shape: thread effectiveProviderUsed ?? provider into the diagnostic row write on both the success and error paths (the same expression the usage row uses), and record the auth-resolved provider alongside if the distinction is worth keeping for /inspect (e.g. a payload field authProvider), so the row provider means what served the call. Sweep every reader of the row provider column before changing its meaning (git grep "log.provider" and the diagnostic browse/render in bot-client) and state per reader whether it wants resolved or effective.
Acceptance: a unit test on the generation step writes a diagnostic row with provider openrouter when the fallback set effectiveProviderUsed to OpenRouter and the auth provider was zai-coding; diagnosticCost.test.ts gains a case with that row shape producing a cost object; the existing usage-row providerUsed tests are unchanged.
<!-- SECTION:DESCRIPTION:END -->
