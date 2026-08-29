---
id: TASK-818
title: tracker task create on a feature branch issues a duplicate id
status: To Do
assignee: []
created_date: '2026-08-29 14:37'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 818000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: OBSERVED 2026-08-29, not hypothetical. `pnpm tracker task create` numbers the new task by scanning `tracker/tasks/` in the WORKING TREE. Tracker tasks are committed straight to `develop`, so a feature branch cut before a given task does not contain that file — and the CLI reissues its id. Live sequence: TASK-816 (ratchet operationalization) was filed and pushed to develop; a later `task create` run from the feature branch `fix/zai-endpoint-not-model-prefix` was assigned **TASK-816 again**, for a completely unrelated task. Caught by eye at creation time and recovered by deleting the file and refiling from develop, where it became TASK-817.

Why it matters more than a numbering nit: had it merged, `tracker/tasks/` would hold two DIFFERENT files both declaring `id: TASK-816`. Every `--search`/`-l` query and every cross-reference by id becomes ambiguous, and the failure is silent at creation — the CLI reports success and prints a plausible id. Whether `pnpm ops backlog` would catch the collision post-merge is UNVERIFIED and worth checking as step 1: if it does, that is the backstop and this task is only about failing earlier; if it does not, the gate has a real hole.

The near-miss condition is narrow but ordinary: any session that files a task while working on a feature branch. That is not rare — it is what the promise-ledger rule asks for (file at the moment of utterance), so the rule and the tooling currently pull against each other.

Fix shape (pick after checking the gate): (a) a PreToolUse hook on `tracker task create` that refuses, or loudly warns, when the current branch is not `develop`/`main` — the deterministic-trigger/mechanical-correction shape `00-critical.md` prefers, and a sibling of the existing board-commit-branch-gate, which governs board COMMITS on branches and does not see a bare CLI invocation; or (b) have the CLI derive the next id from `git ls-tree origin/develop -- tracker/tasks/` rather than the working tree, so the number is branch-independent; or (c) make `pnpm ops backlog` hard-fail on duplicate ids as the merge-time backstop regardless of which of the above lands.

(b) is the most correct — it removes the failure rather than reporting it — but it reaches into the Backlog.md CLI rather than our own tooling, so check whether the id derivation is ours to change before committing to it.

Acceptance: filing a task from a feature branch either cannot produce a colliding id or is blocked with a message naming develop as the place to file; and duplicate ids in `tracker/tasks/` fail a gate rather than merging silently. Include the observed 816/817 case as the regression fixture.
<!-- SECTION:DESCRIPTION:END -->
