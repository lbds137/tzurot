---
id: TASK-86
title: 'Dashboard action naming convention drift (kebab vs snake)'
status: To Do
assignee: []
created_date: '2026-05-06 00:00'
labels:
  - 'area:db'
dependencies: []
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Dashboard action naming convention drift (kebab vs snake)

**Why:** `DASHBOARD_ACTIONS` mixes `confirm-delete`/`cancel-delete` (kebab) with `edit_truncated`/`cancel_edit`/`view_full`/`open_editor` (snake). Pre-existing in character; persona mirrored. Strings encoded into Discord custom IDs in user channels — rename requires a migration path. ~50-80 LOC + ~1 month deprecation window. **Promote when**: a dashboard refactor pass touches customId parsing, OR a third dashboard adopts the truncation gate. Surfaced 2026-05-06 PR #984 round 4 + 7. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
