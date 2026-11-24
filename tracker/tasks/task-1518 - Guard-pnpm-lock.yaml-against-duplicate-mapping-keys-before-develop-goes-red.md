---
id: TASK-1518
title: Guard pnpm-lock.yaml against duplicate mapping keys before develop goes red
status: To Do
assignee: []
created_date: '2026-11-24T00:53:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1518000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: rebase-merging two dependabot group PRs one after the other combined their pnpm-lock.yaml edits as text and left a duplicated snapshot key (@tybys/wasm-util@0.10.5). Every CI job then failed at pnpm install --frozen-lockfile with ERR_PNPM_BROKEN_LOCKFILE, which blocked release PR 2796 until PR 2798 removed the duplicate. Nothing caught it before merge, because each PR was green against its own base.

What: either (a) a cheap duplicate-key check (a top-level key repeated within one lockfile section) in pre-push and CI, which fails on the broken shape with a pointer to the fix, or (b) a merge-procedure rule: after one dependabot group merges, @dependabot rebase the other before merging it. The tzurot-git-workflow skill already has a similar step for dev-tooling bumps. (b) prevents the shape; (a) catches any source of it.

Acceptance: a lockfile carrying a duplicated snapshot key fails a gate before it reaches develop (probe: re-add the 5 deleted lines from PR 2798 and confirm the gate goes red), or the dependabot sequential-merge rule is in the skill with its trigger named.
<!-- SECTION:DESCRIPTION:END -->
