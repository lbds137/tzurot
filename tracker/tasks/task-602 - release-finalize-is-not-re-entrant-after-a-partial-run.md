---
id: TASK-602
title: 'release:finalize is not re-entrant after a partial run'
status: Done
assignee: []
created_date: '2026-08-14 11:02'
updated_date: '2026-09-02 00:30'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 602000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.201 finalize failed midway — the rebase succeeded, then the force-push was rejected by the pre-push lines:check gate (CURRENT.md over budget). Retrying after fixing the budget aborted at `git pull --ff-only origin develop` with "Not possible to fast-forward", because run 1 had already rebased local develop onto main, so local had diverged from origin/develop. The tool cannot distinguish "has not run yet" from "already ran partway": its ff-only precondition (finalize.ts:209) encodes "develop is untouched", true on first run and false on every retry. The recovery had to be done by hand.

This is reachable by anything that fails between the rebase and a successful force-push — a pre-push gate, a network drop, an interrupted session — not just the line-budget case.

Fix shape: before the ff-only pull, detect the already-finalized-locally state and skip the pull rather than aborting. The safe predicate, both halves required: `git merge-base --is-ancestor origin/main HEAD` (local develop already contains main) AND `git cherry HEAD origin/develop` empty (origin/develop holds no commits local lacks). When both hold, local develop IS the rebase result and the only remaining step is the force-push. Anything else keeps the current loud failure.

Acceptance: a finalize interrupted after the rebase but before a successful push completes cleanly on retry, with no manual git. Unit-test both the resumable state and a genuinely-diverged develop that must still fail loudly.
<!-- SECTION:DESCRIPTION:END -->
