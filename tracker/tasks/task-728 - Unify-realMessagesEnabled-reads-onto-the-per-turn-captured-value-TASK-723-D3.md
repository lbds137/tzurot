---
id: TASK-728
title: Unify realMessagesEnabled reads onto the per-turn captured value (TASK-723 D3)
status: To Do
assignee: []
created_date: '2026-08-22 13:47'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 728000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two direct getSystemSetting reads remain (RenderableReference.ts:265 choosePrefix; ReferencedMessageFormatter.ts:377 instruction pick) beside ContentBudgetManager.ts:226 single capture — a mid-turn staged-rollout flip mixes modes within one prompt; the wording-only justification is a fragile invariant. Design record: prompt-assembly-architecture.md 9d D3.
What: thread the captured value through renderHistoryEntryBody opts to formatQuotedSection to dedupeReference to choosePrefix (parameter), and to formatReferences from its caller. Exactly ONE getSystemSetting read of the flag per turn. TASK-727 kill-switch flag rides the same capture — land this FIRST.
Acceptance: grep shows one read site; both wording pickers take the parameter; tests updated at the seams.
<!-- SECTION:DESCRIPTION:END -->
