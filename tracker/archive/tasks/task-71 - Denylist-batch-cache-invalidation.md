---
id: TASK-71
title: Denylist batch cache invalidation
status: To Do
assignee: []
created_date: '2026-02-15 00:00'
updated_date: '2026-09-04 19:41'
labels:
  - 'area:bot-client'
  - 'area:redis'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Denylist batch cache invalidation

**Why:** Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen. Surfaced 2026-02-15 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:41
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. no merit: the task's own body is the reason not to do it (premature optimization for bulk ops that rarely happen); no trigger, no cost, no acceptance.
---
<!-- COMMENTS:END -->
