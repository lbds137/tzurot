---
id: TASK-819
title: cwd-drift-guard misfires for worktree-isolated agents on bare git commands
status: Done
assignee: []
created_date: '2026-08-29 16:42'
updated_date: '2026-09-01 23:43'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 819000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two independent worktree-isolated workers in the 2026-08-29 window reported the same friction verbatim: the cwd-drift-guard.sh hook misfires on a bare `git diff` run from inside an agent worktree, forcing every dispatched agent to work around it with `git -C <absolute-worktree-path>`. The guard exists to catch the MAIN checkout stranded in a package dir; an agent whose cwd IS its own worktree root is not drifting. Every dispatch pays a retry or a workaround for a false positive.

Fix shape: teach the guard to recognize a worktree root as a valid cwd — e.g. treat any directory containing a `.git` FILE (worktree marker, vs the main checkout where .git is a directory) as non-drifted, or compare against `git rev-parse --show-toplevel` instead of the hardcoded repo root. Update the probe with a worktree-shaped case.

Acceptance: a bare `git diff` from an agent worktree root passes the guard; the original drift case (main checkout stranded in packages/tooling) still fails it; probe covers both.

Process provenance: agent-generated filing from the 2026-08-29 mining run (approved set D) — counts against the drain net.
<!-- SECTION:DESCRIPTION:END -->
