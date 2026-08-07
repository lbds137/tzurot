---
id: TASK-459
title: >-
  gh:ci-gate should verify --sha is actually the PR head, closing the HEAD-drift
  window structurally
status: Done
assignee: []
created_date: '2026-08-07 10:20'
updated_date: '2026-08-07 13:11'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 458000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 1994 embedded $(git rev-parse HEAD) in the canonical monitor invocation, which removed the SHA-transcription failure class (four occurrences in one session). It introduced a narrower, quieter one in exchange: the substitution resolves when the Monitor executes, so anything moving HEAD between the push and the arm makes the gate watch a different SHA. Checking out another branch is the likely trigger, and filing a tracker task between pushes does exactly that.

The existing validation gives ZERO protection here, which is the important part. FULL_SHA and gitHasCommit both pass on a moved HEAD, because it still names a real local commit. The transcription failure was loud (instant UsageError); this one is silent (the gate waits on a real SHA whose CI is fine or absent). Raised by the PR 1994 round-4 review, which correctly noted this is documented discipline where 00-critical.md § Fix Recurring Failures Structurally asks for a system-level close.

Fix shape: gh:ci-gate already receives the PR number. Fetch that PR and compare its head SHA to --sha; on mismatch, say which SHA the PR actually points at and stop. That converts a silent wrong-target into an instant, self-explaining error.

Do NOT implement this as a hard failure without handling replication lag first. The same head_sha index lag documented in 05-tooling.md § PR Monitoring means a comparison run immediately after a push can read a stale head and reject a perfectly good arm. Options worth weighing: compare on the first SUCCESSFUL poll rather than at startup, since by then the API has settled; or warn rather than exit and let the operator judge. Measure the lag before choosing — the same measure-then-decide discipline that corrected the stale twenty-minute CI figure in that file.

Acceptance: arming the gate on a SHA that is not the PR head produces an immediate message naming both SHAs, and a normal arm-right-after-push is never rejected by replication lag.
<!-- SECTION:DESCRIPTION:END -->
