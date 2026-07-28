---
id: TASK-337
title: >-
  openTasks() treats any non-Done status as open — revisit if the status enum
  grows
status: To Do
assignee: []
created_date: '2026-07-28 01:53'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:backlog'
  - 'size:S'
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
