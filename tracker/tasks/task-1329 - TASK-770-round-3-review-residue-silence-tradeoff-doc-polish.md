---
id: TASK-1329
title: 'TASK-770 round-3 review residue: silence tradeoff doc + polish'
status: To Do
assignee: []
created_date: '2026-10-30T00:07:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1312000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2688 round-3 review (merged 4d5af731e) found no blocking issues; its low/nit notes are merged-as-is residue. (1) A failed verification prompt now leaves an all-nsfw-blocked batch with NO response (sendNsfwVerificationMessage swallows reply failures; the generic notice was previously a second attempt) — reviewer-endorsed tradeoff, option chosen: document it in shouldSuppressAllFailedNotice JSDoc, nobody should later read total silence as a bug. (2) deliverAllFailedNotice guard comment repeats the full rationale the helper JSDoc already carries — shorten to a pointer. (3) Two INFO logs per all-denied batch (coordinator decision line + deliverAllFailedNotice suppressNotice field) — pass counts in or trim. (4) Derive ErroredSlotOutcome as Omit of the SlotOutcome errored variant. (5) Add an unsupported-channel expected:false row to the helper table.
What: the five notes above, one small PR touching MultiTagCoordinator.ts, multiTagCoordinatorHelpers.ts/.test.ts, multiTagDeliveryFlow.ts.
Acceptance: tradeoff documented at the helper; single INFO line per all-denied batch; derived type; table row present.
<!-- SECTION:DESCRIPTION:END -->
