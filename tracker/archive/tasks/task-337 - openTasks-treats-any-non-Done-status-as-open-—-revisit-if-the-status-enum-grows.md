---
id: TASK-337
title: >-
  openTasks() treats any non-Done status as open — revisit if the status enum
  grows
status: To Do
assignee: []
created_date: '2026-07-28 01:53'
updated_date: '2026-09-04 19:44'
labels:
  - 'area:backlog'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 337000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: trackerTasks.ts openTasks() filters status.toLowerCase() !== 'done', so every non-Done status counts as open. Correct for the current enum (To Do / In Progress / Done in backlog.config.yml), but a future cancelled-type status (e.g. Won't Do) would wrongly count as open in the digest and deferred-refs surfaces.
Fix shape: teach openTasks() the closed-status set alongside the config change, and decide how a cancelled status interacts with the ruled-out exit (today: archive + removing commit).
Promote when: backlog.config.yml statuses change. Surfaced by PR #1823 round-2 review.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:44
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: a fourth status is added in backlog.config.yml next to the code that reads it.
---
<!-- COMMENTS:END -->
