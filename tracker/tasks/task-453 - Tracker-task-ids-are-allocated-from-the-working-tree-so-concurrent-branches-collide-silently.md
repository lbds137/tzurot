---
id: TASK-453
title: >-
  Tracker task ids are allocated from the working tree, so concurrent branches
  collide silently
status: To Do
assignee: []
created_date: '2026-08-07 00:54'
updated_date: '2026-08-07 12:33'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 452000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed live on 2026-08-06. The Backlog.md CLI picks the next task id by scanning tracker/tasks/ in the CURRENT working tree. Tasks filed on an unmerged branch are therefore invisible to any other branch, so two branches that both file a task get the SAME id.

Concrete instance: TASK-451 was filed on branch docs-monitor-stop-prior (canonical CI-monitor command hand-synced across three surfaces). Later the same evening, filing from branch refactor-ops-cli-usage-errors produced a DIFFERENT task, also numbered 451, because the first one did not exist in that working tree. Both would have merged to develop carrying id 451. Caught by hand and renumbered to 452; nothing mechanical would have caught it.

Why the existing gate does not help: pnpm ops backlog validates the tree it can see. Each branch parses cleanly in isolation — the collision only exists in the union, which no single check ever evaluates. Post-merge the two files coexist with duplicate ids, and every id-based query (task edit, task view, cross-references from other tasks) becomes ambiguous.

This will recur whenever work happens on two branches at once, which on this project is routine. Five tasks were filed across three branches that single evening.

Fix shapes to consider:
- Allocate ids against origin/develop plus the local tree, not the local tree alone, so an unmerged sibling branch is still counted.
- Add a duplicate-id check to pnpm ops backlog that runs against the MERGE RESULT rather than the working tree — e.g. compare local task ids against origin/develop and fail on a reused id.
- Drop sequential ids entirely in favour of something collision-free.

The second option is the cheapest and catches the case at push time, which is where it matters, but it does not prevent two in-flight branches from both claiming an id before either merges.

Acceptance: filing a task on a branch while a sibling branch holds an unmerged task cannot produce a duplicate id, or the duplicate is caught before it reaches develop.

## OBSERVED LIVE 2026-08-07

Hit exactly as predicted, no hypothesis needed. `pnpm tracker task create` was
run on `develop` while an open PR branch already carried a freshly-filed
TASK-464. The CLI allocated **464 again**, because it counts from the working
tree and the branch's file is not there. No warning, no collision error - two
different tasks with the same id, one per branch, which would have merged into a
silently duplicated id.

Caught only because the same session filed both and recognised the number. A
session that filed one of them yesterday would not have.

Detection that worked, worth reusing in the fix:

    git log --all --diff-filter=A --name-only --pretty=format: \
      | grep -oE 'task-[0-9]+' | sort -t- -k2 -n | tail -3

That reads every id ever ADDED on any branch, so it is immune to the
working-tree blind spot. A pre-create check against it, or a `backlog` lint rule
comparing the max working-tree id against the max all-branches id, would have
refused the allocation.

Recovery was manual: rename the file, edit `id:` and `ordinal:` in frontmatter,
re-run `pnpm ops backlog`.

## PARTIALLY SHIPPED 2026-08-09 (commit 3322c7749)

Fix shape 2 landed: `checkDuplicateTaskIds` (in-tree union hard fail) +
`checkOriginIdCollisions` (new local file reusing an id already on
origin/develop), both wired into `pnpm ops backlog` (backlogLint.ts:422-423)
with tests. TASK-492 (filed later the same day, duplicate ask) was closed
against that commit. What remains open here: the ALLOCATION side - the CLI
still numbers off the working tree, so two in-flight branches can both claim
an id and the gate only catches it at the second branch's post-merge push.
Also absorbed from TASK-492's soft clause: a working-tree check that a task
FILENAME's id token agrees with its frontmatter `id:` (today `fileIdToken` is
only consulted inside the origin-collision path, so a hand-edited mismatch in
the local tree passes the gate silently).

SECOND, UNRELATED CLI GOTCHA found in the same sitting: repeated `-l` flags
(`-l area:process -l size:S -l state:ready`) do NOT append - only the LAST one
survives. Both tasks filed this session lost two of three labels that way. The
comma form (`-l area:process,size:S,state:ready`) works. This is silent; the
only reason it was caught is that `pnpm ops backlog` gates on all four label
axes and failed. Worth a line in 06-backlog.md next time that file is touched.
<!-- SECTION:DESCRIPTION:END -->
