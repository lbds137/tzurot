---
id: TASK-556
title: >-
  Request dedup entry is written after job creation - deploy-window retry can
  double-bill
status: Done
assignee: []
created_date: '2026-08-12 22:32'
updated_date: '2026-08-13 11:59'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 556000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2061 retries kind=network submits across deploy windows, but the gateway order is checkDuplicate -> createJobChain -> cacheRequest (generate.ts:91-99). A gateway killed between enqueue and cacheRequest (exactly the deploy/SIGTERM event the retry targets) leaves a billable job with NO dedup entry, so the retry creates a second chain: double AI spend, two replies to one message. Compounding: retry attempts 3-4 land at t~6s/14s, outside REQUEST_DEDUP_WINDOW=5000 (timing.ts:107), so even the covered mid-flight-reset case is unprotected past attempt 2. checkDuplicate also fails open on Redis errors.

Fix shape: reserve the dedup entry (SET NX) BEFORE createJobChain, or carry a client-generated idempotency key; raise REQUEST_DEDUP_WINDOW to >= 20s so it spans the full backoff.

Acceptance: a test pinning that a retry after kill-between-enqueue-and-cache hits dedup; window covers the retry span. Source: 2026-08-12 fresh-context review of beta.198-200 (bot-client reviewer F1/F2, mechanism CONFIRMED by code order + constants).

## Council pass 2026-08-12 (GLM 5.2 / Kimi K3 / Qwen 3.8 Max) — UNANIMOUS, no split

Verdict: **the content hash is the wrong identity, and that is the real bug.** A hash of message text cannot distinguish a retried submit from a user repeating themselves, so every policy built on it trades one against the other and no window length resolves it. All three converged on: client-generated idempotency key, atomic reserve-before-enqueue keyed on that key, and a retry-spanning TTL **on the idempotency key** rather than on the content hash.

Kimi appears to dissent by endorsing the wider window; it does not. Its wider window is on the idempotency key, which is exactly what the other two endorse. **All three reject widening the CONTENT-hash TTL** — which means the user-visible regression that made this an owner decision (identical short message twice in the window collapsing to one reply) does not occur under the recommended design. That concern is resolved, not traded away.

Unanimous secondary finding, NOT in the original filing: **checkDuplicate failing open on Redis errors is wrong on a billing path.** The reservation should fail closed (503, nothing enqueued). Two of the three note that once the endpoint is genuinely idempotent, the client may also safely retry timeouts and 5xx, which it deliberately does not today. **Owner decision required** — this rejects live traffic during a Redis incident.

### Premise correction (mine, found while grounding the council's answers)

The filing and the council prompt both treated "a reservation written before enqueue has no jobId yet" as a hard constraint. It is not true here. `jobChainOrchestrator.ts:452` already supplies a custom BullMQ id, `${JOB_PREFIXES.LLM_GENERATION}${requestId}`, and `requestId` is minted in `generate.ts` before `createJobChain` runs — so the jobId is already derivable pre-enqueue and the reservation can be written COMPLETE. No pending state, no polling, no JobTracker refactor. GLM spent its answer solving this non-problem (it proposed retiring the jobId-keyed JobTracker, a five-call-site change); disregard that portion.

### Two constraints the council could not know

- **The key must NOT be the Discord message id alone.** Qwen rightly prefers a stable Discord identifier over an ephemeral UUID (survives a bot-client restart), and `triggerMessageId` is already threaded into the submit's retry context. But one user message fans out to N characters through MultiTagCoordinator, and one `/chime-in tag:` invocation runs N independent turns — keying on the message alone would collapse a fan-out into a single reply, turning a billing fix into a feature outage. The key needs the personality dimension.
- **BullMQ's add-with-existing-jobId no-op is UNPROBED.** Kimi proposes it as a structural second layer beneath the cache, and it is nearly free since we already pass custom ids — but that is an external-system claim. Probe against real Redis before relying on it.

### Owner decision 2026-08-12: FAIL CLOSED

The reservation fails closed — a Redis error on the reserve write returns 503 and enqueues nothing. Grounding that narrowed the question before it was asked: the dedup cache's client (`index.ts:166`, `new Redis(envConfig.REDIS_URL)`) and BullMQ's connection (`queue.ts:26`, `parseRedisUrl(config.REDIS_URL)`) are separate clients against the SAME Redis server, so during a full Redis outage `createJobChain` (a BullMQ add) errors regardless — fail-closed changes nothing user-visible there. It differs only under PARTIAL degradation (one client's command times out, the other's does not), which is exactly the case where fail-open double-bills. The council's stated cost for this option ("rejects live traffic during a Redis incident") does not apply as strongly here as it assumed.

**Caveat found after shipping (PR 2085 review round 6) — see TASK-585.** The fail-closed guarantee is only half-delivered. The route returns 503 when reserve() REJECTS, but the dedup Redis client is constructed with no commandTimeout, so a partially degraded Redis can leave the SET or GET hanging indefinitely and the request never reaches the catch at all. Partial degradation is exactly the scenario this decision was made for, so the gap sits where the guarantee is supposed to hold. TASK-585 carries the fix and the hazard (that client is shared with eight pub/sub invalidation services, so a blanket timeout on it is NOT the right shape).

### Recommended delivery split

Gateway-only atomic reserve-before-enqueue ships first: it stops the double-bill, has zero user-visible surface, and needs no schema change — that is this task, and it stays size:S. The idempotency key (bot-client → gateway schema, keying change, client retry-policy widening) is its own follow-on and should be filed separately when the owner picks it up. Do not attempt both in one PR.
<!-- SECTION:DESCRIPTION:END -->
