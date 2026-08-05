---
id: TASK-242
title: FreeTierRequestQuota.tryConsume pipelining (perf)
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:redis'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 242000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

FreeTierRequestQuota.tryConsume pipelining (perf) — `tryConsume` does up to 10 sequential Redis round-trips (2×zremrangebyscore, 2×zcard, get, then on allow 2×zadd, incr, 3×expire) on every guest/BYOK-fallback message. An ioredis `.pipeline()` (non-transactional — preserves the check-then-increment ordering) cuts it to ~2 round-trips without touching the atomicity tradeoff. Deferred from PR #1564 review (non-blocking) because it also needs the unit-test mock reworked from per-method spies to a pipeline stub. **Promote when**: the free-key path shows latency, or during a quota perf pass.

**Why:** Hot-path latency; behavior-neutral. Surfaced 2026-07-08 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
