---
id: TASK-720
title: Extend cwd-drift-guard to tracker CLI and file edits from a worktree cwd
status: Done
assignee: []
created_date: '2026-08-21 21:18'
updated_date: '2026-09-01 23:43'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 720000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the guard blocks git commands with repo-root-relative pathspecs when the shell cwd has drifted, but twice in one session (2026-08-21) non-git commands slipped through the same seam: a pnpm tracker task create ran with cwd in an agent worktree and filed the task file in the WORKTREE with a colliding task id (the worktree base predated the latest id), and a python file edit resolved a tracker/ glob against the worktree copy. Both were caught by reading output/status, but the class is deterministic and mechanical -- exactly hook territory.

Fix shape: in .claude/hooks/cwd-drift-guard.sh (or a sibling PreToolUse check), when the persistent shell cwd is under .claude/worktrees/, also block pnpm tracker task/doc mutations and warn on commands whose arguments reference tracker/ or CURRENT.md relatively -- the tracker store and board belong to the main checkout only. Keep read-only tracker queries allowed. Hook changes need a probe per guard:hook-probes and land via review-gated PR.

Acceptance: from a worktree cwd, a pnpm tracker task create is blocked with a message naming the main checkout path; the probe covers the blocked and allowed cases; main-tree behavior unchanged.
<!-- SECTION:DESCRIPTION:END -->
