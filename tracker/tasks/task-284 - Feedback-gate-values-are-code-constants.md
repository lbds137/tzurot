---
id: TASK-284
title: Feedback gate values are code constants
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:common-types'
  - 'area:docs'
  - 'area:backlog'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 284000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Feedback gate values are code constants — runtime-config them on second retune — `FEEDBACK_LIMITS` (300s cooldown / 5 daily / 7d dedupe window) ships as deliberate constants in common-types. If the owner retunes them more than once, fold them into the admin-settings runtime config (the accepted [`admin-runtime-settings`](../../docs/proposals/backlog/admin-runtime-settings.md) proposal's disposition table is the home). **Promote when**: the second retune request. Surfaced 2026-07-15 (PR-4 build).

**Why:** One retune is a constant edit; two is a knob wanting a dashboard.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Promote-when is "the second retune request." `FEEDBACK_LIMITS` has only ever been touched by its introducing commit — no retune has happened once, let alone twice. Evidence: `git log --oneline -S "FEEDBACK_LIMITS" -- packages/common-types` → single commit (`7aa4d1ea1`, the feature that introduced it).
---
<!-- COMMENTS:END -->
