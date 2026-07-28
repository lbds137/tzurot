---
id: TASK-18
title: Tombstone LWW same-ms create-then-delete tie
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-11 — tombstone LWW uses wall-clock TIMESTAMP(3) only; a same-ms create-then-delete tie fails toward preservation (deliberate), but a genuinely fast create→delete could resurrect a row across sync. **Fix shape**: sequence number (or logical clock) alongside the timestamp closes the class. **Promote when**: any prod resurrection is observed, or next sync-schema migration. Surfaced by #1589 release review (non-blocking).

**Why:** Wall-clock ties are the one hole in LWW deletion semantics.
<!-- SECTION:DESCRIPTION:END -->
