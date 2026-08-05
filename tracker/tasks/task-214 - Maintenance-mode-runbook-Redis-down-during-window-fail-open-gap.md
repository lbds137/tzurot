---
id: TASK-214
title: 'Maintenance-mode runbook: Redis-down-during-window fail-open gap'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:db'
  - 'area:redis'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 214000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Maintenance-mode runbook: Redis-down-during-window fail-open gap

**Why:** `MaintenanceFlag` fails OPEN on Redis errors (correct for normal operation), which means if Redis is down during the exact destructive-migration window, traffic is NOT quiesced precisely when quiescing matters most. Reviewer-flagged (beta.149 release review), accepted as a narrow known edge. **Fix shape**: one runbook line in `/tzurot-deployment` ("verify `maintenance status` shows ON before premigrate; if Redis is down, do not proceed") — optionally a `maintenance verify` hard-check subcommand later. **Promote when**: next touching the deployment skill or before the next destructive release. Surfaced 2026-07-06.
<!-- SECTION:DESCRIPTION:END -->
