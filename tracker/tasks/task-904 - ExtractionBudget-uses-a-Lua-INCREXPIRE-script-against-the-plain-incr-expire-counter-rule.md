---
id: TASK-904
title: >-
  ExtractionBudget uses a Lua INCR+EXPIRE script against the plain incr/expire
  counter rule
status: To Do
assignee: []
created_date: '2026-09-07 01:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 902000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: .claude/rules/03-database.md § Redis counters says counters default to the VisionFallbackQuota shape (plain incr, then expire, non-atomic, fail-open) and Lua only on a demonstrated concurrency harm or a hard financial cap. services/ai-worker/src/services/extraction/ExtractionBudget.ts uses an INCR+EXPIRE Lua script for atomicity, and its header cites RedisRateLimiter for the crash-between-INCR-and-EXPIRE race. The extraction worker runs at concurrency 1 and the class fails open on Redis errors, so neither Lua justification applies; the archive-summary budget (PR #2351, review round 1) was converged onto the plain shape rather than copying the script a third time.
Fix shape: replace the eval with redis.incr then redis.expire, keep the per-personality UTC-day key, keep tryConsume/refund signatures and the fail-open posture; update the header comment to cite the rule; the existing tests swap the eval assertion for incr/expire. A missed EXPIRE is self-healing because the key embeds the UTC date.
Acceptance: no Lua string in ExtractionBudget.ts; pnpm --filter @tzurot/ai-worker test green; the rule file needs no change.
<!-- SECTION:DESCRIPTION:END -->
