---
id: TASK-1349
title: >-
  Rules cite pnpm tracker doc search, which errors - the live form is pnpm
  tracker search
status: To Do
assignee: []
created_date: '2026-11-04T13:35:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1332000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 10-working-posture.md and 09-interaction-style.md both instruct pnpm tracker doc search <term>, but the tracker CLI has no doc search subcommand (doc offers only create/update/archive/restore; verified 2026-11-04) - every literal follow-along dies with ELIFECYCLE exit 1. The shared index search that actually covers tasks, documents, and decisions is pnpm tracker search <term> (verified: positive control hit TASK-786).
<!-- SECTION:DESCRIPTION:END -->
