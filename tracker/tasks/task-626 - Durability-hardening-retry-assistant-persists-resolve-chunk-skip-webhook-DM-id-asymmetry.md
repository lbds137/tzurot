---
id: TASK-626
title: >-
  Durability hardening: retry assistant persists; resolve chunk-skip +
  webhook/DM id asymmetry
status: Done
assignee: []
created_date: '2026-08-16 04:52'
updated_date: '2026-08-17 00:15'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 626000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: an assistant turn can be delivered to Discord and never persisted, leaving an orphaned user row the model reads back next turn. Measured 2026-08-15 (16 deployments + 7-day DB probe, 816 turns): rate is at most 0.12%, so the pending_memories-style outbox was RULED OUT on evidence; this task is the surviving proportionate hardening.

Fix shape (one small PR, bot-client):
1. Wrap the assistant-persist gateway calls (persistDeliveredTurn in SlotDeliveryService; the MessageHandler slash path) in the existing withGatewayRetry from gatewayRetry.ts. Safe here because the persist is idempotent by construction (deterministic id + compareExisting + P2002 fallback) - so full isRetryableGatewayFailure retryability applies, unlike the generate() site which restricts to isConnectionFailure because it creates a paid job.
2. Resolve the deliberate empty-chunkMessageIds skip (ConversationPersistence.ts ~303-306) - decide persist-vs-skip semantics when delivery reported zero ids.
3. Webhook/DM id asymmetry: webhook pushes chunk ids conditionally and degrades to empty; DM pushes unconditionally and throws - align the two.

Acceptance: a transient gateway failure during assistant persist is retried and succeeds without redelivery; the chunk-skip and asymmetry each have an explicit, tested decision. Candidate rider on the beta.203 release plan (not gating).
<!-- SECTION:DESCRIPTION:END -->
