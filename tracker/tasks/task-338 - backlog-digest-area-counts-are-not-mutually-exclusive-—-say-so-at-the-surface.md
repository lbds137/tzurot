---
id: TASK-338
title: 'backlog:digest area counts are not mutually exclusive — say so at the surface'
status: To Do
assignee: []
created_date: '2026-07-28 02:35'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:backlog'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 338000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: countByArea() increments every area:* label a task carries, so a multi-area task counts in each of its areas and the By-area section can sum past the open-task total. Intentional (tasks span areas) but unstated — a reader could expect the counts to sum.
Fix shape: one clarifying line in the digest output header (or a code comment in backlogDigest.ts countByArea) noting counts overlap for multi-area tasks.
Surfaced by PR #1823 round-5 review.
<!-- SECTION:DESCRIPTION:END -->
