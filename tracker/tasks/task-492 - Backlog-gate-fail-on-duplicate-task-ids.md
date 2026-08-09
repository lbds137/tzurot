---
id: TASK-492
title: 'Backlog gate: fail on duplicate task ids'
status: To Do
assignee: []
created_date: '2026-08-09 17:01'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 492000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the tracker CLI numbers new tasks off local state, so tasks created in parallel on different branches collide (observed 2026-08-09: TASK-487 assigned twice - Sonnet pilot on a PR branch, blocking-questions on develop - caught by hand, renumbered to 488; pnpm ops backlog passed both states silently).
What: extend the backlog integrity gate to fail when two task files carry the same id (and probably when filename number and frontmatter id disagree).
Acceptance: gate red on a fixture with two files sharing an id; green on the current store.
<!-- SECTION:DESCRIPTION:END -->
