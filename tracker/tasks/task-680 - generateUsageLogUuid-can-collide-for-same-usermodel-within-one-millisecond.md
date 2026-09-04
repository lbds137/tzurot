---
id: TASK-680
title: generateUsageLogUuid can collide for same user+model within one millisecond
status: To Do
assignee: []
created_date: '2026-08-19 13:13'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 680000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: usage_logs ids derive from userId:model:millisecond-timestamp (packages/common-types/src/utils/deterministicUuid.ts:335). Two usage rows for the same user and model landing in the same millisecond collide on the primary key. Every caller writes usage fail-soft inside a try/catch, so the second write is swallowed and the spend it represents silently vanishes from the ledger — which is the one number those rows exist to make queryable.

Callers today: FactExtractionService.logExtractionUsage, AIJobProcessor, and rosterBlurbSweep.logUsage. Predates this work; the roster sweep is the first caller to write usage rows in a loop, which is what surfaced it.

CORRECTION (2026-08-19, verified after this task was filed): the premise below
was wrong, and it was the stated reason for the recommendation. `usage_logs` is
in EXCLUDED_TABLES in services/api-gateway/src/services/sync/config/syncTables.ts
-- "Environment-specific usage tracking", never synced. So changing the id
derivation carries NO dev/prod sync risk. That cost is zero.

The recommendation to leave it survives for a better reason, found in the same
check: the only path where a collision is realistically REACHABLE is
AIJobProcessor (chat completions), because the main worker runs at
WORKER_CONCURRENCY > 1 and multi-character fan-out produces several completions
for one user on one model at nearly the same instant. That path already wraps
its usage write in a retry loop with `const createdAt = new Date()` INSIDE the
loop (AIJobProcessor.ts ~line 424), so a collision retries 100ms later with a
different millisecond and a different id. It heals itself.

The two loop-writing paths (FactExtractionService, rosterBlurbSweep) have no
such retry, but every write is separated by a model call -- seconds of network
round trip -- so the same millisecond is not reachable. The residual risk is the
INTERSECTION of the two: a path where collisions are reachable AND unretried. No
such path exists today.

Promote when (sharper than the original): a new writer emits multiple usage rows
in a tight loop with NO network call between them -- batching several rows after
one batch API call, say. That is the only shape that makes collisions both
reachable and unretried.

Fix shape (also over-scoped originally): the cheap fix is for extraction and the
roster sweep to adopt the same retry-with-fresh-timestamp pattern AIJobProcessor
already uses. No signature change, no id-derivation change, no sync concern --
the original "needs a signature-level decision about a discriminator" framing
was built on the false sync premise above.

Raised in the PR #2149 round-2 review and flagged again in round 3 as untracked; filed here because a PR-body mention is not a destination.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Per the task's own 2026-08-19 correction, the fix shape narrowed to "adopt AIJobProcessor's retry-with-fresh-timestamp pattern" for the two loop-writing callers — neither `FactExtractionService.logExtractionUsage` nor `rosterBlurbSweep.logUsage` has that retry loop; both are still single-shot try/catch fail-soft writes. Evidence: `sed -n '246,271p' services/ai-worker/src/jobs/rosterBlurbSweep.ts` and `sed -n '297,330p' services/ai-worker/src/services/extraction/FactExtractionService.ts` → both single-attempt, no retry; contrast with `AIJobProcessor.ts:415-435`'s `for (attempt = 1; attempt <= maxRetries...)` loop, which the two callers still lack.
---
<!-- COMMENTS:END -->
