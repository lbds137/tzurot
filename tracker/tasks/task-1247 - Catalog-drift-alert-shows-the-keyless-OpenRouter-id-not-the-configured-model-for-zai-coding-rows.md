---
id: TASK-1247
title: >-
  Catalog drift alert shows the keyless OpenRouter id, not the configured model,
  for zai-coding rows
status: To Do
assignee: []
created_date: '2026-10-18 22:12'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 1235000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since PR 2632 (TASK-1240, owner ruling: watch the keyless route) a zai-coding row is checked under its z-ai/ fallthrough id, and CatalogDriftEntry.modelId carries that rewritten id, so the owner alert (services/bot-client/src/services/catalogAlert/setupCatalogDriftAlertWorker.ts buildCatalogDriftEmbed) can name z-ai/glm-5 for a config whose row says glm-5. Raised by claude-review on PR 2632 round 2.

What: carry the configured model (and provider) in CatalogDriftEntry (common-types types/jobs.ts catalogDriftAlertJobDataSchema), and render e.g. glm-5 (keyless route: z-ai/glm-5) when they differ. Contract change: update the producer contract fixture (services/api-gateway/src/services/CatalogDriftContract.producer.test.ts) and the bot-client consumer.

Acceptance: a zai-coding drift renders both ids; an openrouter drift renders one; contract tests green.
<!-- SECTION:DESCRIPTION:END -->
