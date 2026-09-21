---
id: TASK-1034
title: >-
  git-workflow skill: main-cut recipe must unset upstream and declare
  GITHUB_BASE_REF=main before the first push
status: To Do
assignee: []
created_date: '2026-09-21 15:36'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1028000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the main-cut recipe in .claude/skills/tzurot-git-workflow/SKILL.md (section Claude workflow changes target main) says to pass --base main for LOCAL guard runs or open the PR first, but the pre-push hook (.husky/pre-push, both guard:workflow-sync call sites) runs the guard with no flag and the PR cannot exist before the first push, so the first push of every main-cut branch fails closed. Observed 2026-09-21 on the claude-code-action 1.0.230 carrier (PR #2465): one lost push cycle. Two facts the recipe omits: (1) the guard reads GITHUB_BASE_REF as a declared merge target (packages/tooling/src/dev/check-workflow-sync.ts, resolveExplicitBase), so GITHUB_BASE_REF=main git push -u origin <branch> is the sanctioned first push; (2) git checkout -b <branch> origin/main sets the upstream to origin/main, so the guard gh pr view lookup asks about branch main and the failure line names the wrong branch - git branch --unset-upstream before the first push fixes it.
Fix shape: add both lines to the recipe step 1, one sentence each, in a skills PR via develop (skills are review-gated).
Acceptance: the recipe names GITHUB_BASE_REF=main for the first push and the unset-upstream step; a dry read of the recipe by a fresh session produces a first push that passes the pre-push guard.
<!-- SECTION:DESCRIPTION:END -->
