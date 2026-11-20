---
id: TASK-1476
title: 06-backlog.md follow-ups from PR 2772 round 6
status: To Do
assignee: []
created_date: '2026-11-20T05:54:00Z'
labels:
  - area:repo
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1476000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2772 hit its review-round cap with four small rule/doc inconsistencies left. What: (1) 06-backlog.md says HOT active-epic.md is read at session start, but Starting a Session reads it only at step 5 when Current Focus is empty: add it to step 2 or reword the Structure bullet; (2) the task create example in The tracker store omits the size, state and priority axes the same rule requires at filing: show the comma form -l area:<x>,size:S,state:ready --priority medium, after running it; (3) docs/reference/architecture/epic-identity-hardening.md: drop the stale (Inbox entry, 2026-04-16) parenthetical after TASK-1473; (4) trim owner-gated from the Structure bullet TASK-1467 pointer (task state inside an always-loaded rule). Acceptance: all four applied; pnpm ops lines:check and pnpm ops backlog green.
<!-- SECTION:DESCRIPTION:END -->
