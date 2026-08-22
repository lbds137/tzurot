---
id: TASK-722
title: >-
  Orchestration skill: literal commands for the transfer-gate checks + --ignored
  caveat
status: To Do
assignee: []
created_date: '2026-08-22 01:17'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 722000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2178 round-6 review (at the round cap, filed instead of iterating): the two checks gating git worktree remove --force in /tzurot-orchestration § Nested dispatch — byte-identical patch comparison and status --porcelain emptiness — are prose, while the skill elsewhere demands exact commands; and status --porcelain omits gitignored paths (needs --ignored), so a worker-created file under a gitignored path could be force-removed silently.

Fix shape: spell the two checks as literal commands (diff -q of the patch vs the applied diff; the porcelain invocation), and add a one-line --ignored caveat. Review-gated PR (skill is load-bearing); ride the next orchestration-skill edit rather than opening a PR for this alone.

Acceptance: both gate checks are copy-pasteable commands and the gitignored-path loss window is named.
<!-- SECTION:DESCRIPTION:END -->
