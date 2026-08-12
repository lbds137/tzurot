---
id: TASK-553
title: 'git-workflow: verify a referenced task is COMMITTED before claiming it filed'
status: Done
assignee: []
created_date: '2026-08-12 13:46'
updated_date: '2026-08-12 19:23'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 553000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2077 round 6. The PR body said "Filed as TASK-552". The file existed on disk and was never committed, so from every other vantage point - git log, another checkout, a future session, the reviewer - the task did not exist. The reviewer searched and correctly reported it missing.

pnpm ops backlog PRINTED the untracked-file warning naming that exact file, twice, in output that was read past. That warning shipped in 2069 for precisely this failure, which makes this a case of a working detector plus an inattentive reader rather than a missing detector. The warning is deliberately non-gating (a half-written task file is a legitimate working state), so it cannot be promoted to a hard failure without breaking that.

What: extend the closing-reference step in the git-workflow skill - the one TASK-547 added - so it covers FORWARD references too, not only Closes TASK-N. Before writing that a task was filed, confirm the file is tracked (git ls-files on the path, not existsSync), and commit it before the PR body claims it. The check is one command and belongs next to the quote-the-acceptance-line step, since both exist to stop a claim about tracking state from outrunning the tracking state.

Why not now: .claude/skills is review-gated. Batch with TASK-530 and any other skills edits.

Acceptance: the git-workflow skill names the moment before a PR body claims a task was filed, and the check is git-tracked-ness rather than file existence.
<!-- SECTION:DESCRIPTION:END -->
