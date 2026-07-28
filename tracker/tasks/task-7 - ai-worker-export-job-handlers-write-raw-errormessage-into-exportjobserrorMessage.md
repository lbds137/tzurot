---
id: TASK-7
title: Sanitize export-job errorMessage (no raw error.message passthrough)
status: Done
assignee: []
created_date: '2026-07-16 00:00'
updated_date: '2026-07-28 14:01'
labels:
  - 'area:ai-worker'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-07-16 (#1662 r2) — ai-worker export job handlers write raw `error.message` into `export_jobs.errorMessage`, and the shapes list route (`shapes/export.ts` list handler) returns that field VERBATIM to the authenticated user — provider/infra error strings (which can carry connection detail) reach end users. #1662 sanitized the gateway-side enqueue writer; the WORKER-side writers (`ShapesExportJob.ts`, `AccountExportJob.ts`) still store raw messages. **Fix shape**: a small message-taxonomy pass in the worker handlers (classify → user-safe copy, full error to logs — the `cleanupStuckExportJobs` "worker may have restarted" copy is the precedent), or stop selecting `errorMessage` on the list route and derive display copy from `status`. **Promote when**: next touch of either export job handler, or a user reports a confusing/leaky export error string.

**Why:** Low-severity info-leak class: authenticated user, own jobs only — but raw infra errors don't belong in user-facing fields.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped as PR #1828 (merged 2026-07-28): classifyShapesError passes through only typed shapes errors (isKnownShapesError allowlist, fail-safe) and stores generic copy otherwise; four precondition throws typed as ShapesJobValidationError (non-retryable, authored copy preserved); avatarError defense-in-depth catch sanitized. AccountExportJob unchanged — its route withholds errorMessage (read-side boundary by design). Registry consolidation filed as TASK-341.
<!-- SECTION:NOTES:END -->
