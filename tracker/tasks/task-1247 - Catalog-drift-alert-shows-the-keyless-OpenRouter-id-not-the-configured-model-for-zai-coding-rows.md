---
id: TASK-1247
title: >-
  Catalog drift alert shows the keyless OpenRouter id, not the configured model,
  for zai-coding rows
status: To Do
assignee: []
created_date: 2026-10-18 22:12
updated_date: '2026-11-24T12:52:00Z'
labels:
  - area:api-gateway
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1235000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since PR 2632 (TASK-1240, owner ruling: watch the keyless route) a zai-coding row is checked under its z-ai/ fallthrough id, and CatalogDriftEntry.modelId carries that rewritten id, so the owner alert (services/bot-client/src/services/catalogAlert/setupCatalogDriftAlertWorker.ts buildCatalogDriftEmbed) can name z-ai/glm-5 for a config whose row says glm-5. Raised by claude-review on PR 2632 round 2.

What: carry the configured model (and provider) in CatalogDriftEntry (common-types types/jobs.ts catalogDriftAlertJobDataSchema), and render e.g. glm-5 (keyless route: z-ai/glm-5) when they differ. Contract change: update the producer contract fixture (services/api-gateway/src/services/CatalogDriftContract.producer.test.ts) and the bot-client consumer.

Acceptance: a zai-coding drift renders both ids; an openrouter drift renders one; contract tests green.

Second case (2026-11-24 prod alert, 04:26): the global preset GLM 5.4 (Reasoning: high), an openrouter-provider row with model z-ai/glm-5.4, fired the drift alert because OpenRouter does not list glm-5.4. The alert says turns fall to the fallback chain, but for a user holding a z.ai key the request auto-promotes to z.ai (ProviderRouter.tryAutoPromoteToZai), so only keyless users fall through. The embed overstates the effect for any z-ai/ model that auto-promotes. Extra acceptance: when the drifted model is a z-ai/ id, the embed says z.ai-key holders are unaffected (auto-promotion) and only keyless turns use the fallback chain. Priority raised to medium: the alert already fired once on a working model and reached the owner as noise.
<!-- SECTION:DESCRIPTION:END -->
