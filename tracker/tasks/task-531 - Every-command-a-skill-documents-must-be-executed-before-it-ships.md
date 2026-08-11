---
id: TASK-531
title: Every command a skill documents must be executed before it ships
status: To Do
assignee: []
created_date: '2026-08-11 20:02'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 531000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2066 is the evidence. It documented four git command shapes; THREE of them were wrong or incomplete until someone actually ran them, and each was caught by execution rather than by reading:

1. The verification snippet used git ls-remote with && and ||, which prints "deleted" after a fatal "Could not read from remote repository" - any nonzero falls into the || branch. Found by running it against a bad remote.
2. The worktree cleanliness check used @{u}.., which exits 128 with "no upstream configured" on a branch created but never pushed - exactly the state being checked for. Found by running it on an upstream-less branch.
3. The removal ORDER put the push-status check behind a --force caveat, but plain git worktree remove refuses only on a DIRTY tree, never on committed-but-unpushed work. So the check never fired in the one case it existed for, and the following --delete-branch made those commits unreachable. Found by reproducing the whole path in a scratch repo.

Item 3 is the important one for this task: it had already been read end to end by the author and pronounced coherent an hour earlier. Reading cannot catch this class, because the reader brings the same wrong model that produced the text. Only execution is independent of the author.

What: state the rule where skill authoring is governed - a command block in a skill or rule is not documentation, it is code a future session executes verbatim, so it ships only after being run, and the doc says what was observed. Also worth naming the corollary: an example commit message is a command too (2066 shipped a wip: example that commitlint type-enum rejects).

Placement is 07-documentation.md or the skills-authoring surface; .claude/rules is review-gated and the task-513 trial carries a no-rules-edits boundary, so this rides a rules PR like TASK-520 and TASK-523.

Acceptance: the authoring guidance requires execution before a command block ships, and says the doc should record what was observed rather than what was expected.
<!-- SECTION:DESCRIPTION:END -->
