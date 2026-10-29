---
id: TASK-1326
title: 'Deny docstring: soften always-bot-wide claim + pin check-order message'
status: To Do
assignee: []
created_date: '2026-10-29T22:13:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1309000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-4 review on PR #2687: the denyTarget.ts docstring says a server denial is always bot-wide, but that is a write-path guarantee (gateway + modal); no DB constraint backs it, so a legacy, manual-SQL, or sync GUILD row at a narrower scope would render in browse yet be ignored by the cache — and the modal now refuses to edit its reason unless re-scoped to BOT (arguably the right push, worth knowing). Also unpinned: which message wins for a GUILD entry at BOT scope with a non-* scope ID (the BOT-requires-* check runs before the GUILD check today).
What: soften the denyTarget.ts sentence to a write-path guarantee; add the GUILD+BOT+non-* rejection test pinning the message order.
Acceptance: docstring hedges the DB-level claim; the order-pin test exists and is red-first proven.
<!-- SECTION:DESCRIPTION:END -->
