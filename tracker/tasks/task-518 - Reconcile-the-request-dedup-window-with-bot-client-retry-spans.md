---
id: TASK-518
title: Reconcile the request-dedup window with bot-client retry spans
status: To Do
assignee: []
created_date: '2026-08-11 02:30'
updated_date: '2026-08-13 02:31'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 518000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2061 gave the generation submit a bounded retry spanning ~14s, while api-gateway REQUEST_DEDUP_WINDOW is 5s (packages/common-types/src/constants/timing.ts) and the dedup entry is only written AFTER createJobChain succeeds (services/api-gateway/src/routes/ai/generate.ts). PR 2061 narrowed the submit retry to connection failures only, so the ambiguous cases (timeout, 5xx) no longer repeat a request the gateway may already have turned into a paid job. The residual: a network-kind failure also covers a mid-flight reset, where the request DID land, and a retry landing more than 5s later misses the dedup cache and creates a second job plus a second reply.

What: decide whether the dedup window should cover the worst-case retry span (widening it changes dedup semantics for a user legitimately re-sending the same message, which is why this is not an agent-side call), or whether the submit should carry an idempotency key the gateway honours regardless of window. Surfaced by the claude-review on PR 2061 (Medium, code-read mechanism, not runtime-observed).

Acceptance: either the window and the retry span are reconciled with the reasoning recorded, or an idempotency key makes the window irrelevant for this path.

## Decision 2026-08-12: the idempotency key, NOT a wider window

The either/or this task posed is answered. A council pass on TASK-556 (GLM 5.2 / Kimi K3 / Qwen 3.8 Max) unanimously rejected widening the CONTENT-hash TTL: a hash of message text cannot distinguish a retried submit from a user repeating themselves, so any window long enough to cover the ~14s retry span also collapses a user's legitimately-repeated short message into one reply. No window length resolves that trade — the identity is what is wrong.

TASK-556's PR closed the other half of this task's Why (the entry written only AFTER createJobChain) with an atomic reserve-before-enqueue. What remains here is exactly the deferred follow-on: a client-supplied idempotency key, keyed so the gateway honours it regardless of window.

Two constraints for whoever builds it:

- **The key must carry a personality dimension.** A stable Discord identifier is preferable to an ephemeral UUID (it survives a bot-client restart) and triggerMessageId is already threaded into the submit retry context — but one user message fans out to N characters via MultiTagCoordinator, and one chime-in tag invocation runs N independent turns. Keying on the message alone would collapse a fan-out into a single reply, turning a billing fix into a feature outage.
- **BullMQ add-with-existing-jobId as a second layer is UNPROBED.** Kimi proposed it as a structural backstop beneath the cache, and it is nearly free since custom ids are already passed — but that is an external-system claim. Probe against real Redis before relying on it.

Once the endpoint is genuinely idempotent, the client may also safely retry timeouts and 5xx, which it deliberately does not today.

### Third motivation, added at PR 2085 (owner decision: absorb it here rather than build a bespoke signal)

The 2085 review found that the new fail-closed 503 is structurally unretryable by bot-client. isConnectionFailure returns only kind === network (utils/gatewayRetry.ts) and deliberately excludes every 5xx, on the reasoning that a 5xx comes from a gateway that had already begun handling the request. That reasoning does not hold for a reservation-failure 503: reserve() throws before createJobChain, so nothing was enqueued and the retry is unconditionally safe — but the client cannot distinguish it from any other 5xx. Net effect until this task ships: a transient blip scoped to the dedup Redis connection, which previously failed open and was invisible, surfaces as a hard user-facing error.

The owner chose to absorb this here rather than add a distinguishing error code in 2085, because making the endpoint genuinely idempotent lets the client retry 5xx generally and fixes this case for free — a bespoke dedup-unavailable-safe-to-retry code would be deleted the moment this lands. Whoever builds this should verify the fix lands: after the idempotency key ships, confirm the reservation-503 path is retried.
<!-- SECTION:DESCRIPTION:END -->
