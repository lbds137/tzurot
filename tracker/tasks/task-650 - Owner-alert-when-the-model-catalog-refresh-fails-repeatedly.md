---
id: TASK-650
title: Owner alert when the model-catalog refresh fails repeatedly
status: To Do
assignee: []
created_date: '2026-08-18 01:19'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 650000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2134 review finding 2. ModelCatalogRefresher only logger.errors on a failed refresh. The TTL/3 interval means one or two failures are harmless, but ~3 consecutive failures (roughly 24h of OpenRouter being unreachable, or a bad key) re-creates the exact silent-degradation state the refresher was built to eliminate -- ai-worker falls back to pattern-matching capability data and nothing tells the owner.

Prior art: every bot-client scheduler guarding an invisible-degradation risk posts to the owner channel -- SecretRotationNagScheduler, RetentionNagScheduler, ReleaseFlagNagScheduler. This is the same shape, in api-gateway instead.

Fix shape: count consecutive failures in the refresher and notify the owner past a threshold (2 is one full TTL of margin consumed; 3 is the last tick before the key lapses). api-gateway has no owner-notify path today -- check whether it routes through a queue to bot-client rather than duplicating the Discord client.

State is observable: the signal arrives on its own the next time OpenRouter has a sustained outage.

Acceptance: N consecutive failed refreshes produce exactly one owner-visible notification, not one per tick; recovery resets the counter.
<!-- SECTION:DESCRIPTION:END -->
