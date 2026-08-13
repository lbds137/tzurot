---
id: TASK-436
title: RAILWAY_CLI_REFERENCE CSV snippets name dead tables
status: Done
assignee: []
created_date: '2026-08-05 04:58'
updated_date: '2026-08-13 23:54'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 436000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: docs/reference/RAILWAY_CLI_REFERENCE.md (~lines 705, 730, 741) shows CSV backup/restore snippets referencing activated_channels and user_personality_settings - both tables no longer exist (now channel_settings and user_personality_configs). Surfaced by the doc-58 drift pass; out of that pass scope (file was not in the audit nine).

Fix shape: update the snippets to current table names, or replace them with a pointer to the database-backup-strategy proposal if the CSV approach is itself obsolete.

Acceptance: no dead table names in the file.
<!-- SECTION:DESCRIPTION:END -->
