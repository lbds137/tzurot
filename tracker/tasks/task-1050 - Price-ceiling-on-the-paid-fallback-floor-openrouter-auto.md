---
id: TASK-1050
title: Price ceiling on the paid fallback floor (openrouter/auto)
status: To Do
assignee: []
created_date: '2026-09-22 21:38'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1044000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the paid text floor is openrouter/auto (fallbackTextModel admin setting, default AUTO_ROUTER_MODEL, packages/common-types/src/schemas/api/systemSettingsRegistry.ts fallbackTextModel entry). Auto routes across the whole OpenRouter catalog including frontier models at 10-50 USD per M tokens. No OpenRouter call carries a price cap: OpenRouterFetch.ts (lines 56-64) injects only transforms, route and verbosity, and FreeTierRequestQuota meters request counts, not spend. The floor only runs after every configured chain is exhausted, so exposure is rare but unbounded when it happens.

Owner decision (2026-09-22): ceiling at 1 USD per M input and 5 USD per M output. That admits the open-weight tier (GLM, DeepSeek, Qwen, Kimi) and excludes the frontier tier. Source: a Fable review of fallback routing, section 1, checked against the code in session. Why 5 and not tighter on output: Kimi K2.6 sits at about 4 USD per M output and is one of the better fallback landings for entity work, so a 3 USD cap would drop it while keeping cheaper, worse options. Re-check that price at build time; if it moved above 5, raise it with the owner rather than silently losing Kimi.

Fix shape: (1) PROBE FIRST: one live OpenRouter request to openrouter/auto with provider.max_price set very low, then read the returned model field, to confirm max_price constrains the routed MODEL and not only the provider within a model. If it does not, the pass-through is a no-op, so stop and re-plan. The simplest alternative needs no code: point the fallbackTextModel admin setting at a fixed cheap model instead of auto. A models array is the other option. (2) A provider.max_price pass-through in OpenRouterFetch, applied only when the target model is a router alias (auto), with the ceiling as a constant or system setting. (3) A request no provider can satisfy under the ceiling must surface as an ordinary fallback failure, not a crash. Pin it with a test.

Acceptance: a fallback request to openrouter/auto carries provider.max_price {prompt: 1, completion: 5} (seam test on the fetch body); non-router targets carry none; the probe result is recorded in the PR body.
<!-- SECTION:DESCRIPTION:END -->
