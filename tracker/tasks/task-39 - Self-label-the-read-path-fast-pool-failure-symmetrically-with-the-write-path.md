---
id: TASK-39
title: 'Self-label the read-path fast-pool failure symmetrically with the write path'
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Self-label the read-path fast-pool failure symmetrically with the write path

**Why:** The two persist routes' WRITE `catch` classifies + logs `{label, sqlstate, durationMs}` via `classifyDbTimeout` before rethrowing, but `compareExisting()`'s `findUnique` (the pre-check + the P2002-race re-read) has no such wrapping. If a dead-conn hits TWICE on that read (retry exhausted at the `applyFastPoolDeadConnRetry` extension), the error propagates to `globalErrorHandler` and logs generically as `'Unhandled error:'` (`errorHandler.ts:29`) — no `label`/`sqlstate`. So a `findUnique`-triggered fast-pool 500 looks like a generic unhandled error, not the self-labeled diagnostic the write path gets. Low severity (double-dead-conn tail case; the retry resolves the common case). **Fix shape**: wrap `compareExisting`'s `findUnique` in the same classify-and-log-on-final-failure the write path uses, OR teach `globalErrorHandler` to `classifyDbTimeout` on fast-pool 500s. **Promote when**: a read-path (`findUnique`) fast-pool 500 shows up in a prod incident review missing the label. Surfaced 2026-07-01 (PR #1423 round-4 review, explicitly non-blocking).
<!-- SECTION:DESCRIPTION:END -->
