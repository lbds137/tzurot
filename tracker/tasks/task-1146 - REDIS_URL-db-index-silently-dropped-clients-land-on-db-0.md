---
id: TASK-1146
title: REDIS_URL db index silently dropped - clients land on db 0
status: Done
assignee: []
created_date: '2026-09-30 07:53'
updated_date: '2026-10-01 21:43'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: joint boot 2026-09-30 proved it at runtime — REDIS_URL=redis://127.0.0.1:6379/1 was set for every boot service, yet redis CLIENT LIST showed all 46 connections on db=0. A stale fixture entry from shared db0 (nsfw:verification:pending:user-123 holding channel-456/reply-123 ids, written ~2026-09-17) leaked into the boot and sent the verification-cleanup scheduler into a 500-retry loop against the Spacebar instance — mis-attributed in doc-109 until the fork disproved it. Isolation of any boot or environment split via the URL db index is currently impossible.

What: honor the URL path db index wherever REDIS_URL is decomposed into host/port/password for ioredis (bot-client BotRedis, api-gateway queue + cache-invalidation clients, ai-worker) — pass db through. Pin with a config test asserting the parsed db index and a seam test on client construction.

Acceptance: a REDIS_URL with /N results in clients on db N in every service; verified live on the boot stack (positive control: the dedicated tzurot-redis-boot container, CLIENT LIST db= per connection).

LIVE VERIFIED 2026-10-01 (boot-b relaunch on the beta.233 build, 91ee1f9f0): REDIS_URL=redis://127.0.0.1:6380/1 on all three services; tzurot-redis-boot CLIENT LIST shows 45/45 app connections on db=1 — the lone db=0 row was the redis-cli probe itself (age=0, cmd=client|list). Fix adcedd68a (#2561). Positive control met; task closed.
<!-- SECTION:DESCRIPTION:END -->
