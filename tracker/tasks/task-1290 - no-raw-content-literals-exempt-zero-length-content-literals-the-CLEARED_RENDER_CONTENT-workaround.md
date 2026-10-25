---
id: TASK-1290
title: >-
  no-raw-content-literals: exempt zero-length content literals (the
  CLEARED_RENDER_CONTENT workaround)
status: To Do
assignee: []
created_date: '2026-10-25 18:23'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1276000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2654 round-7 nit: an exported empty-string constant (CLEARED_RENDER_CONTENT in aliasBrowse.ts) exists only because the rule counts an empty literal at a Discord content position and the allowlist is shrink-only. An empty string carries no user-facing copy, so the rule false-positives on it and the workaround is a named marker per family. Exempt zero-length literals in the rule Discord-content check, then drop the CLEARED_RENDER_CONTENT marker (back to inline empty strings) and shrink the aliasBrowse allowlist entry to 0. Acceptance: rule exempts length-0 literals with a test; the marker constant is gone; allowlist entry deleted.
<!-- SECTION:DESCRIPTION:END -->
