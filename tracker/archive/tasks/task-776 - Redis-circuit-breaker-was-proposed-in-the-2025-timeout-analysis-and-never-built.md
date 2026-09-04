---
id: TASK-776
title: >-
  Redis circuit breaker was proposed in the 2025 timeout analysis and never
  built
status: To Do
assignee: []
created_date: '2026-08-26 21:49'
updated_date: '2026-09-04 19:45'
labels:
  - 'area:redis'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 776000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2025-10-30 Redis timeout analysis proposed four fixes. Priorities 1-3 shipped (explicit connectTimeout/commandTimeout/keepAlive, all services on the shared factory, connection event handlers). Priority 4, a RedisCircuitBreaker in common-types to stop cascading failures when Redis is degraded, was marked Optional and never built. The analysis doc is being deleted in the same change that files this task, because it also prescribed a reconnectStrategy option that PR 2230 proved ioredis ignores, so it had become a trap that would lead a reader to reintroduce dead code. This task exists so the one genuinely unbuilt idea in it is not lost with the doc. Git history has the original sketch.

Start by deciding whether it survives the standing guidance, because it may not: 03-database.md § Redis counters records that this project deliberately prefers plain fail-open Redis calls over added machinery, and that advisors re-suggest resilience layers here which keep getting scrapped. A circuit breaker is a real architectural addition, not a nit, so it needs a deliberate yes rather than being built because a 2025 doc listed it.

Also note the current posture already covers part of the motivation: every factory-built client now carries a 30s commandTimeout, so a degraded Redis produces bounded failures rather than hangs, which was the cascading-failure mechanism the breaker was meant to interrupt.

Acceptance: either a recorded decision not to build it, with the technical reason, or a breaker with a named consumer that demonstrably changes behaviour under a degraded-Redis test.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:45
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. ruled out on merit (C6): a Redis circuit breaker that 03-database.md § Redis counters (plain incr/expire, fail-open, no reflexive machinery) has already declined; every counter path is fail-open by design. Reverse deliberately with a demonstrated failure, not by re-filing.
---
<!-- COMMENTS:END -->
