---
id: TASK-284
title: Feedback gate values are code constants
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:common-types'
  - 'area:docs'
  - 'area:backlog'
  - 'size:S'
dependencies: []
priority: low
ordinal: 284000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Feedback gate values are code constants — runtime-config them on second retune — `FEEDBACK_LIMITS` (300s cooldown / 5 daily / 7d dedupe window) ships as deliberate constants in common-types. If the owner retunes them more than once, fold them into the admin-settings runtime config (the accepted [`admin-runtime-settings`](../../docs/proposals/backlog/admin-runtime-settings.md) proposal's disposition table is the home). **Promote when**: the second retune request. Surfaced 2026-07-15 (PR-4 build).

**Why:** One retune is a constant edit; two is a knob wanting a dashboard.
<!-- SECTION:DESCRIPTION:END -->
