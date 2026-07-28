---
id: TASK-212
title: 'ops queue tooling hardcodes ai-requests, ignoring the QUEUE_NAME env seam'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:ai-worker'
  - 'area:tooling'
  - 'area:db'
  - 'area:jobs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 212000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`ops` queue tooling hardcodes `ai-requests`, ignoring the `QUEUE_NAME` env seam

**Why:** `bullmqConnection.ts`'s `DEFAULT_QUEUE_NAME` is a literal while ai-worker's actual queue name is env-configurable (`QUEUE_NAME`, defaults to the same value). If the env var ever diverged, `pnpm ops maintenance on` would pause/drain the WRONG queue during a destructive-migration window (silent, high-stakes miss); `inspect:queue`/`inspect:dlq` share the seam (lower stakes). **Fix shape**: have the tooling fetch `QUEUE_NAME` from the target env's Railway vars (like it already fetches `REDIS_URL`) with the literal as fallback. **Promote when**: `QUEUE_NAME` is ever overridden in any environment, or when next touching bullmqConnection. Surfaced by #1502 round-4 review. Surfaced 2026-07-06 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
