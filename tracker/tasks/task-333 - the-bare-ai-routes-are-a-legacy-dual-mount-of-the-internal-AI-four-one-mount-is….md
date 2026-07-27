---
id: TASK-333
title: 'the bare /ai/* routes are a legacy dual-mount of the internal AI four; one mount is…'
status: To Do
assignee: []
created_date: '2026-07-27 00:00'
labels:
  - 'area:api-gateway'
dependencies: []
ordinal: 333000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-27 (system-model map §4; owner: known lies need backlog items) — **the bare `/ai/*` routes are a legacy dual-mount of the internal AI four; one mount is supposed to die.** **Fix shape**: pick the surviving mount, migrate any callers, delete the other, remove the map §4 entry. **Promote when**: next api-gateway internal-routes touch, or the drift-audit remediation pass.

**Why:** Documented lie on the system map; leaving both mounts alive invites new callers on the doomed one.
<!-- SECTION:DESCRIPTION:END -->
