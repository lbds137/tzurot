---
id: TASK-542
title: Orchestrator must verify worktree isolation actually applied
status: Done
assignee: []
created_date: '2026-08-12 07:03'
updated_date: '2026-08-12 12:44'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 542000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: an opus-implementer spawned with isolation: worktree did NOT get a worktree. git worktree list showed only the main tree, the worker ran git checkout -b in the SHARED tree, and the orchestrator branch moved mid-turn. A review fixup intended for one PR was committed and pushed onto the worker branch instead. Nothing was lost, but the recovery cost a cherry-pick plus a stray remote branch deletion.

The orchestration skill already mandates isolation: worktree for any file-mutating worker and describes a damage-control freeze for the violation case. What it does not carry is the case where the flag is PASSED and silently does not take effect: the orchestrator has no reason to suspect anything, so it keeps using git normally. This is the same class as the recorded finding that Agent isolation remote degrades to a local worktree silently.

Fix shape: add a post-dispatch verification step to the orchestration skill. After spawning any file-mutating worker, run git worktree list and confirm a NEW tree exists for it; if only the main tree is present, the worker shares the tree and the orchestrator must freeze its own git operations for the duration. Cheap, deterministic, one command. Consider also the weaker but universal guard: re-read git branch --show-current immediately before any commit, since a background agent can move it.

Mechanism note: WHY the isolation did not apply is unknown and was not investigated. Do not record a cause without probing it.

Acceptance: the orchestration skill names the post-dispatch isolation check at the moment of dispatch, so a silently-ignored isolation flag is caught before the orchestrator trusts the tree.
<!-- SECTION:DESCRIPTION:END -->
