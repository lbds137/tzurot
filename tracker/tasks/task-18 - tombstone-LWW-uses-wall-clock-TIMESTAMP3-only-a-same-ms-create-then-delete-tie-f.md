---
id: TASK-18
title: >-
  Document the accepted same-millisecond create-then-delete LWW tie in
  syncTables.ts (owner ruling)
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-11 — tombstone LWW uses wall-clock TIMESTAMP(3) only; a same-ms create-then-delete tie fails toward preservation (deliberate), but a genuinely fast create→delete could resurrect a row across sync. **Fix shape**: sequence number (or logical clock) alongside the timestamp closes the class. **Promote when**: any prod resurrection is observed, or next sync-schema migration. Surfaced by #1589 release review (non-blocking).

**Why:** Wall-clock ties are the one hole in LWW deletion semantics.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER RULING (C11): accept the same-millisecond create-then-delete tie and document it in syncTables.ts (a comment naming the window and why no sequence column). Watch retired into a doc task; retitled; state:ready size:S.
---
<!-- COMMENTS:END -->
