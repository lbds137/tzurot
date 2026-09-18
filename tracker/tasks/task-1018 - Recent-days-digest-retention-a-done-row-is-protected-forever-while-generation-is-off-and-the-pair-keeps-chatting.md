---
id: TASK-1018
title: >-
  Recent-days digest retention: a done row is protected forever while generation
  is off and the pair keeps chatting
status: To Do
assignee: []
created_date: '2026-09-18 16:43'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1014000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the retention sweep (recentDaysDigestRetention.ts) deletes a row only when its pair has no conversation_history row inside the window. With recentDaysDigestEnabled off, or the personality delisted from recentDaysDigestPersonalities, the generation sweep no-ops, so generated_at never advances, while continuing chat keeps the NOT EXISTS guard satisfied — the row ages past the render window (unused) but is never erased, and the privacy row promises erasure a day after it falls out of use. Surfaced by claude-review on PR 2451 round 3.
Fix shape: the retention predicate drops the in-window-history guard when the pair could not be regenerated anyway — the global switch is off, or the personality is not allowlisted — so an unrenderable row is erased on age alone in that state; one PGLite case per branch (switch off with in-window rows: deleted; switch on with in-window rows: kept).
Acceptance: with the switch off, a 9-day-old done row with in-window history is deleted by the sweep; with the switch on, the same row survives.
<!-- SECTION:DESCRIPTION:END -->
