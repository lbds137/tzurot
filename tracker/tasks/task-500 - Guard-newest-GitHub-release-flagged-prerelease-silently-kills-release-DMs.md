---
id: TASK-500
title: 'Guard: newest GitHub release flagged prerelease silently kills release DMs'
status: To Do
assignee: []
created_date: '2026-08-10 00:40'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 500000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.197 sat on GitHub with prerelease=true (and beta.196 undemoted - the exact inverse of what release:publish produces), so the announce pipeline (webhook + hourly reconcile, both envs) skipped it with reason=prerelease and nobody got a DM. Nothing surfaced the mis-state; the owner noticed the silence hours later. The skip is by design (the prerelease gate IS the current-release-only filter); the missing piece is detection of the invariant break.
Fix shape: a cheap check that the NEWEST release by publishedAt is non-prerelease - candidates: (a) the reconcile sweep logs a WARN + owner-channel ops embed when the newest release in its lookback is prerelease-flagged (best: uses the machinery that already runs hourly), (b) a release:finalize/preflight assertion, (c) ops health row. Pick (a) unless reading the code argues otherwise; it needs no new schedule.
Acceptance: a test where the GitHub release list has a prerelease-flagged newest release and the sweep emits the warning surface; beta.197-shaped mis-states become visible within an hour instead of never.
<!-- SECTION:DESCRIPTION:END -->
