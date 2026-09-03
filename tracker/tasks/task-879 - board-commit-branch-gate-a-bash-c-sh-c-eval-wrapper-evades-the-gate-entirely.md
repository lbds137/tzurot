---
id: TASK-879
title: >-
  board-commit-branch-gate: a bash -c / sh -c / eval wrapper evades the gate
  entirely
status: To Do
assignee: []
created_date: '2026-09-03 20:25'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 877000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by the round-4 review on PR 2319 and RUNTIME-CONFIRMED before filing, 2026-09-03. The gate calls strip_quoted only, never executed_segments, so a wrapper hands its whole command to a shell inside a quoted span that strip_quoted collapses to one placeholder token. COMMIT_COUNT comes back 0 and the hook exits 0 unconditionally.

Measured against a feature branch with a board-only file, identical compound each time: unwrapped git add tracker/ and git commit blocks (exit 2), while bash -c with the same string exits 0, sh -c exits 0, and eval exits 0. That is the exact board-only-commit-on-a-feature-branch shape the hook header names as its threat model (3 observed incidents), fully defeated rather than narrowed.

PRE-EXISTING, not a regression from 2319: the pre-port bash version was strip_quoted-only too. 2319 documented it in the hook KNOWN GAPS and corrected the shell_quotes.py CONSUMERS entry (which had cited cwd-drift-guard lower-stakes drift-warning reasoning for a hook whose entire purpose is the higher-stakes case) but deliberately did not change behaviour, because that is a blocking-hook behaviour change needing its own probes.

Fix shape: scan executed_segments in addition to strip_quoted, mirroring what cwd-drift-guard already does for its tracker-write refusal — lib/shell_quotes.py documents executed_segments as exactly the answer to this wrapper class. Feed each executed segment through the same COMMIT_RE / ADD_RE / BYPASS_RE pass and combine. Open questions the implementer must settle: whether bypass counting stays coherent when the commits are split across segments (the gate rests on BYPASSED_COUNT equalling COMMIT_COUNT), and whether a nested wrapper needs recursion or one level is enough.

Acceptance: bash -c, sh -c and eval wrapping of the canonical blocking compound each block (exit 2); the unwrapped cases and the whole existing probe suite stay green; each new case has a demonstrated failing mutation. Reproduction fixtures are in the 2319 round-4 verification, and the shape is one line: bash -c with a quoted git add plus git commit compound.
<!-- SECTION:DESCRIPTION:END -->

