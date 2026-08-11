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

ROOT CAUSE — observed live on the PR 2064 merge, no longer a hypothesis. When the head branch is checked out in a git WORKTREE, gh pr merge --delete-branch fails on the LOCAL delete and the REMOTE branch is left behind too:

    failed to delete local branch feat/audit-servicedirs-discovery: failed to run git:
    error: cannot delete branch ... used by worktree at .claude/worktrees/agent-...

The merge itself succeeds, so the PR closes as merged and only the branch survives. This explains the correlation the owner noticed with "lately": the orchestration skill MANDATES isolation worktree for any file-mutating worker, so every delegated unit now leaves its branch checked out in a worktree at merge time. PR 2061 (also a worktree unit) is the earlier instance.

GENERALIZED 2026-08-11 (PR 2065): the worktree is not the only way to hit this. The blocker is simply that git refuses to delete a branch that is CHECKED OUT ANYWHERE — a worktree is one such place, and the orchestrator's own main checkout is another. An orchestrator that reviews a PR while still standing on its branch will fail the local delete for the same reason, with the same silent remote survivor. State the rule as "the branch must not be checked out anywhere when --delete-branch runs", not as a worktree-specific caveat; the worktree case is then just the instance that is easy to forget because the checkout is not the one you are looking at.

Second path into the same failure, also observed 2026-08-11: resuming a worktree-isolated worker via SendMessage silently drops the isolation, so the resumed worker branches and edits in the MAIN tree — see the TASK-524 entry. That leaves the main checkout sitting on the feature branch at merge time, which is exactly the state described above.

What: two halves.
1. ORDER — ensure the branch is checked out nowhere before gh pr merge (remove the worktree; switch the main checkout back to develop), so --delete-branch can do its job. Belongs in the orchestration skill next to the worktree mandate, and in the git-workflow merge section.
2. VERIFY — after any feature-PR merge, confirm the head ref is gone (git ls-remote --exit-code --heads origin BRANCH) and re-delete if not. The verify half stays worth having even with the ordering fixed: it is what turns any OTHER silent-delete-failure mode into a report instead of a discovery.

Acceptance: a merged feature PR whose branch survived is surfaced at merge time or at the next session-start sweep, without anyone remembering to look; and a worktree-based unit does not produce a survivor in the first place.
<!-- SECTION:DESCRIPTION:END -->
