---
id: TASK-1530
title: Log why a z.ai promotion has no OpenRouter fallback on the promotion info line
status: To Do
assignee: []
created_date: '2026-11-24T14:30:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1527000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a fallback skipped because the OpenRouter catalog confirms the model absent now logs only at debug, so in prod the Auto-promoting info line shows fallbackAvailable false for both catalog-absent and OpenRouter-key-failed; the glm-5.4 incident was diagnosed from exactly these info logs. Raised by claude-review on PR 2801 round 5 (round 4 had asked for debug or a field).

What: add fallbackSkipReason (catalog-absent | or-key-failed) to the Auto-promoting info log in services/ai-worker/src/services/ProviderRouter.ts (grep fallbackAvailable: promotedRoute.fallback), set by attachPromotedFallback.

Acceptance: a ProviderRouter test asserts the info log carries each reason.
<!-- SECTION:DESCRIPTION:END -->
