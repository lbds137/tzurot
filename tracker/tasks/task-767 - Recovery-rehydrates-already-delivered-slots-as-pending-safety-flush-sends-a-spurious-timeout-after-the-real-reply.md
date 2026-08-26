---
id: TASK-767
title: >-
  Recovery rehydrates already-delivered slots as pending - safety flush sends a
  spurious timeout after the real reply
status: Done
assignee: []
created_date: '2026-08-24 17:57'
updated_date: '2026-08-26 12:55'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 767000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in prod ~18 min after the beta.207 deploy (ref 80b5b55b-0c93-46d0-be60-45e23ebebbdc, runtime-confirmed end to end). A group was fully delivered by the old instance seconds before the deploy restart, but its Redis entry outlived the shutdown. The new instance logged "Recovery: slot already delivered by a prior run - skipping dispatch" (kind recoveredCompleted) yet rehydrated the entry with the slot still pending and armed the safety timer (remainingBudgetMs 1021912); 1021s later the safety flush synthesized a timeout error and delivered it in-character - a spurious error message after the user already received the real reply. Not a beta.207 regression: the recovery/rehydration machinery predates it. Trigger window: any group delivered-but-uncleaned in the seconds before a restart, so every deploy risks one.

Fix shape: in MultiTagRecovery, a slot classified recoveredCompleted / already-delivered must enter the rehydrated runtime entry in a delivered terminal state (or the entry must not rehydrate at all when EVERY slot is already delivered - just clean it up). The safety timer should only cover slots that can still produce output. Pin with a test: rehydrate an entry whose only slot is already-delivered, advance past the safety budget, assert NO delivery and NO reply.

Acceptance: a deploy restart immediately after a delivered group produces no follow-up timeout message; the recovery boot log accounts for the entry as cleaned, not rehydrated-pending.
<!-- SECTION:DESCRIPTION:END -->
