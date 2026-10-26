---
id: TASK-1293
title: Batch pick handlers lack a post-ack catch (5 doc-113 flows)
status: To Do
assignee: []
created_date: '2026-10-26T09:56:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1279000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2661 round-3 claude-review. The deny batch pick handler (handleDenyBatchPick in services/bot-client/src/commands/deny/browseBatch.ts) has no local try/catch after its ack, unlike its select-entry, cancel and confirm siblings: a rejected editReply or a throw from buildBatchConfirmView propagates to the generic CommandHandler error path. The facts, memories, alias and override pick handlers share the shape.

What: give all five pick handlers the same post-ack catch the confirm handlers use (error log with userId, ephemeral followUp with the module error copy, its own swallowed-rejection guard), ideally through one shared helper in utils/browse/multiSelectBatch.ts.

Acceptance: each pick handler has a test where editReply rejects and the user gets the ephemeral error reply; no unhandled rejection.
<!-- SECTION:DESCRIPTION:END -->
