---
id: TASK-521
title: Verify the head branch is actually gone after a feature-PR merge
status: To Do
assignee: []
created_date: '2026-08-11 12:50'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 521000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: gh pr merge --rebase --delete-branch prints nothing on success AND nothing useful when the delete does not happen, so a survivor is invisible at merge time and only surfaces later in a repo-state sweep. Measured 2026-08-11: 1 genuine survivor in the last 40 merged PRs (PR 2061), plus 3 release PRs where develop correctly survives. The count drifts up quietly until someone prunes; CURRENT.md records a previous batch of 10 pruned at once.

Not a settings fix: delete_branch_on_merge must stay false. It is the flag that deleted develop on 2026-08-07, it runs admin-privileged, and the develop deletion rule is fully bypassable, so auto-delete passes straight through it. guard:repo-settings asserts the false state.

What: after a feature-PR merge, confirm the head ref is gone (git ls-remote --exit-code --heads origin BRANCH) and say so, or re-delete. Either a step in the git-workflow skill merge section, or folded into the existing repo-state sweep so survivors are reported rather than discovered.

Acceptance: a merged feature PR whose branch survived is surfaced at merge time or at the next session-start sweep, without anyone remembering to look.
<!-- SECTION:DESCRIPTION:END -->
