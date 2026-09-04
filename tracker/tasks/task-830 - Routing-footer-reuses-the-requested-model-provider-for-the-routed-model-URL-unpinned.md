---
id: TASK-830
title: >-
  Routing footer reuses the requested model provider for the routed model URL,
  unpinned
status: To Do
assignee: []
created_date: '2026-08-30 04:22'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 830000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildFooter in services/bot-client/src/services/DiscordResponseSender.ts builds the routed model URL with buildModelInfoUrl(routedModel, providerUsed) — it reuses the REQUESTED model effective provider for the ROUTED model link. That is correct today only because the router aliases are OpenRouter-only constructs (ROUTER_ALIAS_MODELS in packages/common-types/src/constants/ai.ts holds openrouter/auto and openrouter/free), so a turn cannot have modelUsed be a router alias while providerUsed is zai-coding. The invariant is architectural and nothing enforces or pins it.

The routing test in DiscordResponseSender.test.ts asserts only that the footer contains the arrow and the routed shorthand, not the constructed URL or the provider pairing, so a violation would render a link pointing at the wrong provider catalog and no test would notice.

Promote when: any router alias is introduced whose provider is not OpenRouter — a z.ai-side router, or a second provider gaining a meta-router. That is the only condition under which the assumption can break.

Fix shape: strengthen the existing routing test to assert the constructed routed URL rather than substrings, and either derive the routed model provider independently or assert the OpenRouter-only invariant where ROUTER_ALIAS_MODELS is declared.

Raised by review on PR 2256 and deferred on merit rather than on origin: the assumption holds by construction today, the finding is additive test coverage, and the PR was at the review-round cap. Not a defect in current behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed — the routed-model-arm test only asserts substrings (`→`, `(routed)`), not the constructed URL or provider pairing, exactly as the task states. The underlying architectural invariant (router aliases are OpenRouter-only) still holds, so no live bug, but nothing would catch a violation. Evidence: `sed -n '128,143p' services/bot-client/src/services/DiscordResponseSender.test.ts` → the routed-arm test asserts only `toContain('→')` and `toContain('(routed)')`.
---
<!-- COMMENTS:END -->
