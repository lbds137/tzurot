---
id: TASK-967
title: 'Multi-level /history undo: an epoch log instead of the two-slot state machine'
status: To Do
assignee: []
created_date: '2026-09-13 18:07'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 960000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask 2026-09-13 after /history undo restored 1,494 messages hidden by a thread purge (TASK-966). The epoch row (user_persona_history_configs) holds exactly two slots, lastContextReset and previousContextReset, and the undo path empties the previous slot on every swap so a second undo has nothing to restore — the "Only one level of undo is supported" note is a schema-level limit, not a UI one. Owner framing: a correctness nicety, not urgent; once TASK-966 stops purge from writing an epoch, the only thing setting one is a deliberate /history clear.
Fix shape: replace the two columns with an ordered log of clear events per (user, personality, persona) — a small table or a JSONB array of timestamps on the existing row, additive migration — where the active epoch is the newest entry and undo pops it; keep the undo confirmation counting restored messages the way it does today. Decide together with TASK-966 so the epoch semantics change once, not twice.
Acceptance: two consecutive /history clear operations can both be undone in order; the confirmation copy no longer says only one level is supported; the existing single-undo tests still pass.
<!-- SECTION:DESCRIPTION:END -->
