---
id: TASK-341
title: Single-source the shapes error classification (known-set + retryability)
status: To Do
assignee: []
created_date: '2026-07-28 14:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 341000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: isKnownShapesError (services/ai-worker/src/services/shapes/shapesErrors.ts) and the isNonRetryable instanceof chain (services/ai-worker/src/jobs/shapesCredentials.ts classifyShapesError) enumerate the shapes error classes independently. Adding a future error type to only one list has an asymmetric failure: missing from isKnownShapesError fails safe (over-sanitizes to generic copy), missing from isNonRetryable silently leaves a deterministic error retryable (burns BullMQ attempts). Surfaced by the #1828 round-2 review (non-blocking; pattern predates the PR).

Fix shape: one registry colocated with the error classes — e.g. a Map/array of { errorClass, retryable } entries that BOTH the guard and the classification derive from — so a new class is registered exactly once. Keep the fail-safe default (unknown => sanitized + retryable).

Promote when: the next shapes error type is added, or the next touch of classifyShapesError.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost it prevents (asymmetric miss: a new error class omitted from `isNonRetryable` silently burns BullMQ retry attempts). Still two independently-maintained lists. Evidence: `git grep -n isKnownShapesError services/ai-worker/src` and read `shapesErrors.ts:121-131` → `isKnownShapesError` is still a hand-enumerated `instanceof` chain, no shared registry with `classifyShapesError`.
---
<!-- COMMENTS:END -->
