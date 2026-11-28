---
id: TASK-1595
title: Reroll revive can resurrect a memory the user deleted via /memory
status: To Do
assignee: []
created_date: '2026-11-28T20:06:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1585000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review on #2834 (side note to finding 1). A commit revives its attempt memory ids (visibility deleted to normal). Memory ids hash the exchange text, so if a reroll reproduces the same text as a memory the user deliberately deleted through /memory, the vouched revive brings it back. Data-rights edge, rare.
What: distinguish a memory deleted by the user from one soft-deleted by the reroll machinery (a deletedBy or reason marker), and revive only the latter.
Acceptance: a user-deleted memory stays deleted across a reroll that reproduces its text, with a test.
<!-- SECTION:DESCRIPTION:END -->
