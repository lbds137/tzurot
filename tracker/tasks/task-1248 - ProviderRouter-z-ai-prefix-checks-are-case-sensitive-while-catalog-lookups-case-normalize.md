---
id: TASK-1248
title: >-
  ProviderRouter z-ai/ prefix checks are case-sensitive while catalog lookups
  case-normalize
status: To Do
assignee: []
created_date: '2026-10-18 23:32'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1236000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ProviderRouter (services/ai-worker/src/services/ProviderRouter.ts, tryAutoPromoteToZai near line 245 and the zai-coding fallthrough via toZaiOpenRouterFallthroughId in packages/common-types/src/constants/ai.ts) tests startsWith(ZAI_MODEL_PREFIX) case-sensitively, while stripZaiPrefix and the catalog accessors in the same constants file document that preset models may arrive in any case. A zai-coding row typed Z-AI/glm-5 would fall through as z-ai/Z-AI/glm-5, and an openrouter row Z-AI/glm-5 would never auto-promote. Raised by claude-review on PR 2632 round 3; not verified that any row carries an uppercase prefix.

What: count rows first (read-only: SELECT model FROM llm_configs WHERE model ILIKE 'z-ai/%' AND model NOT LIKE 'z-ai/%'). If any, normalize the prefix check (case-insensitive startsWith, keep the bare-name case) in the helper and both router sites; else decide whether to normalize at save time instead.

Acceptance: an uppercase-prefixed model routes and falls through like the lowercase one, pinned by tests.
<!-- SECTION:DESCRIPTION:END -->
