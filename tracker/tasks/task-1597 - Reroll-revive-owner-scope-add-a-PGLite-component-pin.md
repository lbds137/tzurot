---
id: TASK-1597
title: 'Reroll revive owner scope: add a PGLite component pin'
status: To Do
assignee: []
created_date: '2026-11-28T20:34:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1587000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review round 8 on #2834 (nit 3). The fallback revive scope persona.ownerId (rerollCommit.ts:121) on the nullable Memory.personaId relation is pinned only as a mocked updateMany argument. This is the data-rights fix, so the real query deserves a real-DB pin.
What: in historyReroll.component.test.ts, seed a deleted memory on the same personality owned by another user plus one owned by the requester; commit via the body-ids fallback (no vouching job result).
Acceptance: the other owner memory stays deleted and the requester memory is revived.
<!-- SECTION:DESCRIPTION:END -->
