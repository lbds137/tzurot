---
id: TASK-1219
title: >-
  Commit-dir read: a pipe, background & or subshell with a cd and a commit keeps
  the live evaluation
status: To Do
assignee: []
created_date: '2026-10-12 01:48'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1208000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1218 (possible-location walk for ; joins) dropped its pipe/background/subshell clause after measuring it: blocking those shapes when they hold both a commit and a directory change would newly block 25 of 55 replayed recent commands, mostly because the ( of an unquoted $(mktemp -d) reads as a subshell paren and because `| grep`/`| tail` pipes appear beside cds. So `cd <develop worktree> && git commit -m y | cat` and `(cd <develop wt> && git commit)` still keep the live evaluation of the start checkout and can pass from a feature checkout.

What: model these shapes precisely instead of blanket-blocking: a command substitution $(...) that contains no commit is not a subshell for this purpose; a pipeline stage runs in the current location and its cd does not persist; a ( ... ) group runs its own walk from the current location and restores it after. Block only when a commit inside the shape can land somewhere other than the start.

Also in this pass (#2612 review, over-block): the walk has no model of `exit`/`return` ending the shell, so `cd /other-wt || exit 1; git commit -m y` reads as {/other-wt, start} and, from a feature checkout targeting a sibling worktree, blocks as a commit in more than one checkout. A lone `exit`/`return` segment should drop the states that run it (here the failed-cd states), leaving only /other-wt. It fails closed today, and the banner's `&&` remedy applies.

Acceptance: replay of the TASK-1218 corpus (docs/local/dispatch/replay-1209/, machine-local) newly blocks at most a handful, each named; probe rows for `(cd <develop wt> && git commit)` (blocks) and `cd <develop wt> && git commit | cat` (blocks); a rule row for `cd /x || exit 1; git commit -m y` reading `/x` alone.
<!-- SECTION:DESCRIPTION:END -->
