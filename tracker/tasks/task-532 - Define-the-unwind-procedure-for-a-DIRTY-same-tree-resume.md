---
id: TASK-532
title: Define the unwind procedure for a DIRTY same-tree resume
status: To Do
assignee: []
created_date: '2026-08-11 20:08'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 532000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2066 round-8 review, correctly scoped as deferred-pending-data. The new Resuming a worktree-isolated worker section detects a resume that dropped its isolation and says to FREEZE the orchestrator git operations - but it stops there. The one observed incident (2026-08-11, the TASK-139/140 unit) left a CLEAN tree, purely by luck, so there was nothing to unwind and no procedure was needed.

A future occurrence that finds the tree DIRTY is the hard case: worker edits and orchestrator edits are interleaved in one working tree with no record of which hunk came from which, and the usual separation tools do not help - git has no per-author view of uncommitted changes.

Why not written now: writing an unwind procedure from a single clean-tree incident means inventing steps for a situation nobody has seen. That is the measure-then-decide posture in 10-working-posture, and a wrong recovery procedure for a data-loss scenario is worse than an honest freeze, because it would be followed confidently.

What, when it happens: capture the state before touching anything - git status, git stash list, and a full diff to a file outside the repo - then reconstruct which changes belong to the worker from its own report and the spec file list. Write the procedure from that real instance rather than from imagination.

Promote when: a resume-isolation check comes back same-tree AND the tree is dirty. That is the observable; this task exists so the response is captured rather than improvised and lost.

Acceptance: either the procedure written from a real occurrence, or the task archived if the harness stops dropping isolation on resume (see TASK-524).
<!-- SECTION:DESCRIPTION:END -->
