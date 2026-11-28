---
id: TASK-1576
title: 'Ops: clear invalid-key marks (sibling of clear-credit-exhaustion)'
status: To Do
assignee: []
created_date: '2026-11-27T21:29:00Z'
updated_date: '2026-11-27T21:32:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1566000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2829 review round 2 finding 7 - the invalid-key mark (KEY_INVALID_OPENROUTER, 10-min TTL) demotes a BYOK user OpenRouter routing with no operator override except a wallet re-save; the credit mark has tooling/cache clear-credit-exhaustion for manual clears, the invalid mark has none. An OpenRouter-side incident that 401s healthy keys demotes users for the TTL window with no escape hatch. What: a sibling clear verb in the ops cache command (clear-key-invalid, or a shared clear taking the mark kind), listing and clearing by user bucket. Acceptance: the ops command clears a live invalid mark (verified against dev Redis) and tooling tests stay green. Rides-with: update the KEY_INVALID_OPENROUTER consumers list in redis-keys.ts to name the clear command when it lands (PR 2829 review cycle 7 re-found the missing verb; the consumers-list half files here rather than as a new task).
<!-- SECTION:DESCRIPTION:END -->
