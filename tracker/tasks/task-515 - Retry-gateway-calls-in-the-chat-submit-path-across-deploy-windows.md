---
id: TASK-515
title: Retry gateway calls in the chat submit path across deploy windows
status: Done
assignee: []
created_date: '2026-08-11 00:23'
updated_date: '2026-08-11 02:51'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 515000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod 2026-08-11T00:18Z (beta.199 release moment, owner report + log-verified): Railway redeploys services in parallel, and bot-client came up ~8s before api-gateway. A reply arriving in that window (messageId 1536529216659792013, diary thread) failed BOTH persistUserMessageViaGateway and the generate call with "0 fetch failed" at 00:18:39.6 — the new gateway logged its first line at 00:18:40.2, under a second later. The user saw an in-character error ("Slot submission failed") and the trigger-message history row was dropped (designed degradation, heal-on-read covers it).
What: give the chat submit path (PersonalityChatManager.submitChatJob: the generate call in gatewayServiceCalls + persistUserMessageViaGateway) a bounded connection-failure retry, mirroring the existing isRetryableGatewayFailure + exponential-backoff pattern already in gatewayServiceCalls.ts (delivery-ledger reporting). Connection-level failures (fetch failed / ECONNREFUSED) are transient by nature; ~3 attempts over 10-20s absorbs a deploy window entirely. Webhook replies have no 3s ack deadline, so waiting is safe.
Acceptance: a message arriving while the gateway is briefly unreachable gets a real reply once the gateway is up (verified by test with a failing-then-healthy mock seam), not an immediate errored slot; 4xx rejections still fail fast.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Heal-on-read RUNTIME-CONFIRMED (2026-08-11 00:23Z, requestId 75407676-5bfe-4fc2-8d6b-60590d2b7915): the owner re-asked in the same thread 5 min after the incident; the dropped-persist message content appeared 4 times in the new generation payload. The remaining harm from this class is therefore only the immediate errored reply itself — which is what the retry removes.
<!-- SECTION:NOTES:END -->
