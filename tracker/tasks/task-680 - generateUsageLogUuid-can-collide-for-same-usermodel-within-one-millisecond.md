---
id: TASK-680
title: generateUsageLogUuid can collide for same user+model within one millisecond
status: To Do
assignee: []
created_date: '2026-08-19 13:13'
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

Why not fixed at the time: the fix changes an id-derivation function that dev/prod sync depends on being deterministic, so it is a semantic change rather than a nit, and every generation is separated by a real model call — same-millisecond is close to unreachable in practice. My recommendation at the time was to leave it; the owner had not ruled either way when this was filed.

Fix shape: add a discriminator to the seed so concurrent writers cannot collide. The candidates differ per caller (personalityId for extraction and roster blurbs, jobId for AIJobProcessor), so this needs one decision about the shared signature rather than a per-call-site patch. Verify against DatabaseSyncService before changing it — usage_logs id stability is what makes dev/prod reconciliation work.

Raised in the PR #2149 round-2 review and flagged again in round 3 as untracked; filed here because a PR-body mention is not a destination.
<!-- SECTION:DESCRIPTION:END -->
