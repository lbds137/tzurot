---
id: TASK-1136
title: '06-backlog: say that task edit -l REPLACES the whole label set'
status: To Do
assignee: []
created_date: '2026-09-27 21:03'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm tracker task edit <id> -l a,b sets the label list to exactly a,b; labels not named are dropped. 06-backlog.md (the -l bullet) only warns that repeated -l flags do not accumulate on task create. On 2026-09-27 two edits meant to flip a state label dropped origin:review and area:jobs from TASK-288 and changed TASK-1119 size:S to size:M (both restored by hand, develop 99724da21).

What: extend that 06-backlog bullet by one sentence: on task edit, -l replaces the set, so pass every existing label (read them first), or edit the frontmatter.

Acceptance: the bullet names the edit behavior; lines:check green.
<!-- SECTION:DESCRIPTION:END -->
