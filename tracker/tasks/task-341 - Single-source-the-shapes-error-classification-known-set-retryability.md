---
id: TASK-341
title: Single-source the shapes error classification (known-set + retryability)
status: To Do
assignee: []
created_date: '2026-07-28 14:00'
labels:
  - 'area:ai-worker'
  - 'size:S'
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
