---
id: TASK-534
title: Warn when tracker files are untracked in git
status: To Do
assignee: []
created_date: '2026-08-11 21:36'
updated_date: '2026-08-11 23:56'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 534000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a filed task that never gets committed does not exist - it is invisible to every future session, to the digest, and to every query, while LOOKING filed to the person who created it. That is precisely the failure the promise-ledger rule in 06-backlog exists to prevent, arriving through a door the rule does not cover.

Happened TWICE in one session (2026-08-11): TASK-530 rode three autosquash rebases as an untracked file and would have landed in whatever branch was staged next; TASK-533 was created and then left behind while attention moved to code. Both were caught by a manual git status, which is exactly the kind of check that works until it does not.

The mechanism that makes this sticky: pnpm ops backlog PARSES the file, so the gate goes green on a task git has never seen. Green-plus-invisible is the worst combination - the author gets positive confirmation the task is well-formed at the same moment it is failing to persist.

What: have pnpm ops backlog emit a WARNING (never a hard fail) when git status --porcelain tracker/ reports untracked or unstaged entries. It already runs in the pre-push chain, so the catch point is the next push after the task was created - early enough to matter, and it costs one git call. CI never has untracked files, so this is a local-only signal by construction and cannot flake the pipeline.

Not a hard fail: a half-written task file in progress is a legitimate working state, and blocking a push over it would train people to bypass the gate.

Acceptance: creating a tracker task and then pushing anything else surfaces a warning naming the uncommitted file.
<!-- SECTION:DESCRIPTION:END -->
