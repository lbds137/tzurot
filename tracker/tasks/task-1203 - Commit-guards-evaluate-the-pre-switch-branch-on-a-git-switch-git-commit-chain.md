---
id: TASK-1203
title: >-
  Commit guards evaluate the pre-switch branch on a git switch && git commit
  chain
status: Done
assignee: []
created_date: '2026-10-11 11:06'
updated_date: '2026-10-11 17:29'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1192000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: develop-code-commit-guard and board-commit-branch-gate resolve the current branch at PreToolUse time, before a leading branch switch in the same command runs. Session mining (2026-10-11) counted 3 blocks in one session on `git switch -c <new> && git add ... && git commit`, a commit that would have landed on the new branch. Both hooks already print a remedy (issue the switch as its own call), so the cost is a wasted call per trip, not a hole. A second shape is unverified: a commit into a DIFFERENT repo (git -C <other> commit, or cd <other> && git commit) is judged against this checkout (develop-code-commit-guard.sh header names this as a known limitation).

What: a shared Tzurot helper (separate file under .claude/hooks/lib, not the vendored shell_quotes.py, see TASK-1134) that recognises a LEADING `git switch [-c|-C|--create] <name>` or `git checkout -b|-B <name>` joined to the rest by && only, and returns the target branch; both guards then evaluate that branch. `;`/`||` joins and plain `git checkout <name>` (path ambiguity) keep the current behaviour. A -C/-B onto develop or main keeps blocking. Measure the cross-repo shape with a probe row first; if it false-positives, resolve the target repo from -C or a leading cd and exit 0 when it is not this repo.

Acceptance: probe rows for each shape in both guards; the && / ; distinction pinned; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in #2603.
<!-- SECTION:NOTES:END -->
