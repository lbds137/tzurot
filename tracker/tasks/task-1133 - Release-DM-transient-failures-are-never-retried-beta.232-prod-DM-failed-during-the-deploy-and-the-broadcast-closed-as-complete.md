---
id: TASK-1133
title: >-
  Release DM transient failures are never retried: beta.232 prod DM failed
  during the deploy and the broadcast closed as complete
status: To Do
assignee: []
created_date: '2026-09-27 19:13'
updated_date: '2026-09-27 21:03'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod beta.232 (published 2026-09-27 10:53:17Z) announced to 1 recipient, but bot-client ReleaseDmWorker logged "Broadcast DM failed" kind="transient" code="Error" at 10:53:18.002Z (35 ms after enqueue), and api-gateway logged "Broadcast completed" with sent=0 failedTransient=1 at 10:53:18.080Z. Every hourly reconcile since reports alreadyAnnounced=1, so the DM was never retried. Two defects:

1. failed_transient is terminal in practice. dmErrorClassifier.ts documents it as an infrastructure hiccup (rate limit, network, 5xx), which implies retry, but the resweep in api-gateway services/releaseReconcile.ts only re-enqueues pending rows of incomplete announcements, and an announcement whose rows are all non-pending is stamped complete (internal/releaseBroadcast.ts "Broadcast completed").
2. Likely cause, not yet confirmed: the release publish (and so the webhook and the DM job) lands in the same minute as the prod redeploy the release merge triggers, and the worker hit a client that was not ready (generic Error, no Discord API code). Dev deploys on develop pushes, not at release time, which fits dev delivering while prod did not.

What: (a) retry failed_transient rows, either BullMQ attempts with backoff in the worker, or the hourly resweep re-enqueueing failed_transient rows under an attempt cap (with the attempt count on the ledger row); (b) capture the underlying error message/class in the transient log line (a generic "Error" code hides the cause); (c) query prod release_delivery_log (read-only) for earlier releases to see whether this is systematic; (d) consider delaying the announce until the deploy settles.

Acceptance: a transient DM failure is retried until it sends or exhausts a bounded attempt count; the log names the error cause.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Runtime-confirmed 2026-09-27 (railway logs, prod bot-client, deployment 7914fd8f4ebc): process start 10:53:13Z; 'Broadcast DM failed' kind=transient code=Error at 10:53:18.002Z; the same job's owner-channel embed at 10:53:18.075Z failed with 'Expected token to be set for this request, but none was present' (@discordjs/rest, i.e. before login); 'Successfully logged in to Discord' only at 10:53:22.99Z. Mechanism: bot-client serviceFactory.ts createDmWorkers constructs both BullMQ Workers (setupReleaseDmWorker, setupRetentionNotifyWorker) in createServices (index.ts:558), BEFORE client.login (index.ts:584), and BullMQ autoruns, so a job already queued when a new container boots is processed with a token-less client. Class = those 2 workers (git grep of new Worker( and bullmq imports in bot-client src; JobFailureListener QueueEvents starts after login). Also: worker never throws (sendOne catches), so queue attempts:3 never applies; releaseReconcile heals only status=pending rows; retention notices have no resweep at all. Spec: docs/local/dispatch/task-1133-spec.md.

Absorbs TASK-288 (same failed_transient no-retry defect, filed 2026-07-16, its promote trigger fired with beta.232).
<!-- SECTION:NOTES:END -->
