---
id: TASK-1246
title: >-
  Catalog drift sentinels never expire: orphans after re-keying, deletion, or a
  re-point while drifted
status: To Do
assignee: []
created_date: '2026-10-18 22:11'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1234000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: CatalogDriftChecker writes catalog:drift-alerted:<configId>:<modelId> with no TTL (services/api-gateway/src/services/CatalogDriftChecker.ts, the redis.set after addValidatedJob). A pair that stops being evaluated (config deleted, re-pointed while drifted, switched to a skipped provider) never reaches the resolved-branch del, so its key lives forever. PR 2632 (TASK-1240) also re-keyed zai-coding bare-model rows from <id>:glm-5 to <id>:z-ai/glm-5, so any such old-format key on prod is orphaned. Raised by claude-review on PR 2632 round 2.

What: either a long TTL on the sentinel set (e.g. 30 days; cost: a re-alert after expiry if still drifted, arguably a useful reminder) or a sweep that deletes sentinels whose pair is no longer in the watch set. Count prod keys first (read-only SCAN on catalog:drift-alerted:*) to size it.

Acceptance: no unbounded sentinel growth; a test pins the chosen mechanism.
<!-- SECTION:DESCRIPTION:END -->
