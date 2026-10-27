---
id: TASK-1293
title: Batch pick handlers lack a post-ack catch (5 doc-113 flows)
status: Done
assignee: []
created_date: '2026-10-26T09:56:00Z'
updated_date: '2026-10-27T05:06:00Z'
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

What (original): give all five pick handlers the same post-ack catch the confirm handlers use (error log with userId, ephemeral followUp with the module error copy, its own swallowed-rejection guard), ideally through one shared helper in utils/browse/multiSelectBatch.ts.

Acceptance (original): each pick handler has a test where editReply rejects and the user gets the ephemeral error reply; no unhandled rejection.

SHIPPED NARROWED (PR 2669, tests only, no source change; Done 2026-10-27). Grounding found the path already covered: none of the five pick handlers, nor createComponentRouter, nor the deny/override routers catches, so a throw after ackUpdate reaches CommandHandler.handleComponentInteraction's catch, which logs and calls replySpecSafe with CATALOG.error.interactionFailed(); ackUpdate stamps the defer kind so replySpec sends an ephemeral followUp, never an editReply. Pick handlers are read-only view builders, so the generic copy is accurate and module-specific copy (a user-visible change) was not added. Accepted evidence standard, piecewise: per handler (deny, facts, memories, alias, override) an editReply rejection propagates after the ack; the select-menu route of createComponentRouter propagates; the central catch sends one ephemeral followUp; the real deny pick handler runs end to end through CommandHandler. Test-strength follow-ups from the review rounds are filed separately.
<!-- SECTION:DESCRIPTION:END -->
