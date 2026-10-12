---
id: TASK-1218
title: >-
  Commit-dir read: a ; or newline join voids the read, so a cd into a develop
  worktree passes from a feature checkout
status: To Do
assignee: []
created_date: '2026-10-12 00:29'
updated_date: '2026-10-12 00:29'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 1207000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after PR #2609, lib/branch_switch.py _commit_target requires every join to be &&; any ; newline || | or backslash-continuation returns None, which the develop guard reads as judge the live checkout. From a feature checkout `git status; cd <develop worktree>; git commit -m y` therefore still passes while the commit lands on develop (#2609 round-3 review, finding 1). The module docstring sentence "a parse gap can only keep a block, never open one" holds only when the live checkout is develop.

Measured constraint: the #2609 replay found 54 of 55 recent commit-plus-cd commands void, mostly for this join reason, so simply blocking every non-&& command with a dir change and a commit would over-block about 27 commands a week. The design must instead enumerate the POSSIBLE commit locations under ; joins (a failed cd leaves the shell where it was, so each cd before a ; yields both the old and the new location) and let the guard judge every possible location (block when any would block); it can resolve the start location from the payload cwd once TASK-1217 lands.

Also in this pass (same review, low): CDPATH is read from the hook env, and a `CDPATH=x cd rel` prefix assignment is skipped by _command_words; the unreadable banner does not name quoted or spaced paths (cd "/a b" blocks); the pushd -n fail-closed choice has no comment; the replay corpus (or at least its one newly-read case) is not pinned as probe rows; and the round-3 mutation check on _changed_dir absolute branch and the UNREADABLE_DIR-in-results check.

Acceptance: probe rows for `git status; cd <develop wt>; git commit` (blocks), `cd <project dir>; git commit` (unchanged), and a newline-joined variant; the docstring sentence corrected; replaying the 55-command corpus newly blocks at most a handful, each named.

Depends on TASK-1217 (start location from payload cwd).
<!-- SECTION:DESCRIPTION:END -->
