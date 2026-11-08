---
id: TASK-1366
title: 'Review-response: announce every final-round force-push in the report'
status: To Do
assignee: []
created_date: '2026-11-08T19:13:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1349000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ruling 2026-11-08 (via AskUserQuestion): the final-round one-push exception (.claude/skills/tzurot-review-response/SKILL.md:79) stays automatic on feature branches, but it must be announced. On PR 2724 the pre-clear session force-pushed 619016122 and the next session reported nothing had been force-pushed.

What: add one sentence to the exception paragraph requiring --force-with-lease and that the next user-facing report name the force-push with the old and new SHA. Also record it in the role Handoff, so a /clear does not hide an in-flight force-push.

Acceptance: SKILL.md:79 paragraph carries the announce requirement; lines:check green.
<!-- SECTION:DESCRIPTION:END -->
