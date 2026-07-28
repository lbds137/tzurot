---
id: TASK-185
title: >-
  Verify no warm Redis-cache validation break from the kind-required
  LlmConfigSummary bump
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: low
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Verify no warm Redis-cache validation break from the `kind`-required `LlmConfigSummary` bump

**Why:** S2f made `LlmConfigSummary.kind` REQUIRED (was detail-only). If any Redis-cached LLM-config LIST response (serialized pre-`kind`) is deserialized + re-validated against the new schema post-deploy, it would fail `LlmConfigSummarySchema`. **Likely a non-issue**: the gateway always projects `kind` fresh (it's in `LLM_CONFIG_LIST_SELECT`), and the cache audit (`03-database.md`) lists no Redis-backed config-LIST cache (the autocomplete cache is in-memory + 30s TTL, resets on deploy). **Action**: confirm there's no long-TTL Redis cache of the list response before the prod release; if one exists, do a one-time cache invalidation at deploy. **Promote when**: cutting the prod release for the Model-Config epic, or if a post-deploy `LlmConfigSummarySchema` validation error appears. Surfaced 2026-06-29 by PR #1383 (S2f) claude-review (deploy-time, low-risk).
<!-- SECTION:DESCRIPTION:END -->
