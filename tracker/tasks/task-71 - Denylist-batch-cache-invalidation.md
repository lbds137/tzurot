---
id: TASK-71
title: Denylist batch cache invalidation
status: To Do
assignee: []
created_date: '2026-02-15 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:bot-client'
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: low
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Denylist batch cache invalidation

**Why:** Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen. Surfaced 2026-02-15 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
