---
id: TASK-153
title: >-
  ConversationPersistence flatten to module functions (post-CONTEXT_MODE
  cleanup)
status: To Do
assignee: []
created_date: '2026-06-19 00:00'
updated_date: '2026-08-14 01:04'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`ConversationPersistence` flatten to module functions (post-CONTEXT_MODE cleanup)

**Why:** The `contextWritePath`→`gatewayWriteHelpers` rename half of this item shipped in #1311. Remaining half: `ConversationPersistence` is a stateless class (no fields/constructor, 4 save methods) instantiated once in `index.ts` and injected into MessageHandler/SlotDelivery/PersonalityChatManager/SyncExecutor — it could be standalone module exports. **Deliberately parked, not a clear defect**: it's an injected service consistent with the project's constructor-injection DI approach, so flattening is a lateral style change that would churn consumer signatures rather than fix a defect. **Promote when**: next substantively touching `ConversationPersistence`, OR the injection wiring is reworked anyway. Surfaced 2026-06-19 by PR #1268; rename shipped #1311 2026-06-23.
<!-- SECTION:DESCRIPTION:END -->
