---
id: TASK-1436
title: Single-source the Chat and Vision both-slot phrase across the Both setters
status: To Do
assignee: []
created_date: '2026-11-17T14:06:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1436000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: from PR 2759 claude-review r3. The confirmation phrase for a Both pin/clear is built inline as `${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision}` in five places (services/bot-client/src/commands/preset/: global/default.ts, global/free-default.ts, default/set.ts, default/clear.ts, override/set.ts; grep "MODEL_SLOT_LABELS.text} and"). MODEL_SLOT_LABELS single-sources the per-slot labels (packages/common-types/src/constants/ai.ts) but not the pair, so a wording change would need five edits.

What: add a slotLabel(slot: ModelSlot | both) helper (or a BOTH_SLOTS_LABEL constant) beside MODEL_SLOT_LABELS and use it at all five sites.

Acceptance: one definition; the five sites import it; grep for the inline template returns nothing; bot-client suite green.
<!-- SECTION:DESCRIPTION:END -->
