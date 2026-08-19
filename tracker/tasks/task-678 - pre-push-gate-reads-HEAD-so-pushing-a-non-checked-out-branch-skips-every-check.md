---
id: TASK-678
title: >-
  pre-push gate reads HEAD, so pushing a non-checked-out branch skips every
  check
status: To Do
assignee: []
created_date: '2026-08-19 10:57'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 678000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed live 2026-08-19 while backing up fix/task-563-reference-audio-voice-gate. Pushed that branch by name while checked out on develop. The branch carries a code change (services/api-gateway/src/utils/jobChainOrchestrator.ts, +37) and its own commit message says "PARKED, 2 tests red" — the gate printed "No files detected in push - skipping checks" and let it through. Nothing ran.

Mechanism, read from .husky/pre-push lines 38-50 rather than inferred: CHANGED_FILES comes from a name-only diff of UPSTREAM against HEAD, where UPSTREAM is the CURRENT branch’s @{u}. Both sides describe the checked-out branch, not the ref being pushed. On develop-in-sync that diff is empty, so the empty-CHANGED_FILES branch at line 66 fires and skips lint, tests, typecheck, cpd, and every guard.

This is not an exotic invocation — naming a branch while standing on another is ordinary, and it is exactly the shape used to back up or publish parked work. The gate is the local first line for "tests must pass before pushing" (00-critical.md); CI still catches it at PR time, so the exposure is a broken branch reaching the remote, not broken code merging.

Fix shape: git passes pre-push hooks the refs being pushed on STDIN, one line per ref as local-ref, local-sha, remote-ref, remote-sha. Derive CHANGED_FILES from those instead of from HEAD — union each local-sha against its remote-sha, falling back to the merge-base against origin/develop when remote-sha is all-zeroes (a new branch). Keep the HEAD path only as the fallback for empty stdin (direct invocation, probes).

Watch out: the probe must exercise the not-checked-out case specifically. The current probe passes today, so a probe that pushes the branch it is standing on cannot see this bug.

Acceptance: a branch with code changes pushed while checked out elsewhere runs the full gate; the existing probe still passes; a new probe case covers the not-checked-out push.
<!-- SECTION:DESCRIPTION:END -->
