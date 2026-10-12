---
id: TASK-1217
title: 'Commit guards judge the project dir, not the Bash shell''s persisted cwd'
status: To Do
assignee: []
created_date: '2026-10-12 00:20'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1206000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: develop-code-commit-guard.sh and board-commit-branch-gate.sh both cd to CLAUDE_PROJECT_DIR and judge that checkout. The Bash tool keeps its working directory between calls, so after an earlier `cd /abs/develop-worktree` a bare commit lands on develop while the guard judges the project dir; a relative `cd sub` before a commit (read since PR #2609) resolves against the same wrong base. Raised by the #2609 round-2 review (finding 3). The hook payload carries the shell cwd: cwd-drift-guard.sh reads it with jq (.cwd) and blocks on it.

What: in both guards, take the starting checkout from the payload .cwd when present and a directory (fallback: CLAUDE_PROJECT_DIR, the current behaviour), resolve a relative commit dir against it, and when that checkout belongs to a different repository than the project dir apply the existing cross-repo silence. Probe first that .cwd is the live shell cwd after a persisted cd (a hook that logs it), and record the result.

Acceptance: probe rows with a payload cwd in a develop sibling (bare commit blocks), in a feature sibling from a develop project dir (passes), in another repository (silent), and with no cwd (unchanged); the board gate mirrors them.

Batch with TASK-1216 (same guards, same mechanism).

Premise verified at runtime (2026-10-11 20:20 EDT): after one Bash call ran `cd packages/tooling`, the next call was blocked by cwd-drift-guard naming 'packages/tooling', which it reads from the payload .cwd. So .cwd is the persisted shell cwd.

Also (#2609 round-3 review, finding 2): the develop guard's unreadable banner advises "run the cd as its own command first", which leaves a bare commit in a persisted cwd the guard does not model today. In this change, list `git -C <absolute dir> commit` first; keep the separate-cd advice only once the guard judges the payload cwd.
<!-- SECTION:DESCRIPTION:END -->
