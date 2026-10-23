---
id: TASK-1271
title: >-
  claim-shape-guard.sh cds to CLAUDE_PROJECT_DIR, so worktree commits scan the
  main tree
status: To Do
assignee: []
created_date: '2026-10-23 19:23'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
type: bug
ordinal: 1257000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same worktree-cd leak removed-identifier-sweep.sh fixed in PR #2645 round 1 (F5): claim-shape-guard.sh does cd "${CLAUDE_PROJECT_DIR:-.}", so when a commit runs inside a LINKED worktree while husky inherits the session env, the guard jumps to the MAIN tree and scans its index instead of the worktree index - every dispatched worktree commit gets a vacuous pass (nothing staged there), silently no-oping the guard on exactly the commits most likely to need it. Fix shape: REPO=$(git rev-parse --show-toplevel 2>/dev/null) && cd "$REPO" || exit 0, keeping CLAUDE_PROJECT_DIR only as the out-of-repo fallback; mirror the F5 probe work (see task-669-round1-spec P5 for the probe invocation-shape question). Verify the probes registry and guard:hook-probes stay green after the edit.
<!-- SECTION:DESCRIPTION:END -->
