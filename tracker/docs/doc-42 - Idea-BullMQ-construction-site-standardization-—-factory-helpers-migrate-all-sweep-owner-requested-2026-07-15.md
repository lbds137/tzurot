---
id: doc-42
title: >-
  Idea: BullMQ construction-site standardization — factory helpers + migrate-all
  sweep (owner-requested 2026-07-15)
type: other
created_date: '2026-07-28 11:11'
---

## BullMQ construction-site standardization — factory helpers + migrate-all sweep (owner-requested 2026-07-15)

Owner (during PR-3 plan-mode): "do we need a service that manages queues? right now they're scattered everywhere" + Capital One lesson — when the library lands, **standardize around it to kill arbitrary uniqueness**. Resolution: NOT a runtime manager service (queues are Redis-backed and intentionally decentralized; a manager process adds a hop and a SPOF for zero gain — the DI-container shape of over-engineering). The right-sized version: `createStandardQueue()` / `createStandardWorker()` factory helpers in common-types baking in connection config, history limits, the worker convention set (5-min `WORKER_LOCK_DURATION`, `maxStalledCount: 1`, stalled/failed/error log trio — currently copied by hand between services), and graceful-close shape. Defaults stay SMALL (connection, limits, event logging, lock semantics); the moment it grows per-consumer flags it's the Wrong Abstraction — 2-callback ceiling applies. **Acceptance criterion: migrate ALL existing construction sites in the same PR** (~11 across 6 files / 3 services at last count: aiQueue + releaseBroadcastQueue + queueEvents in api-gateway, main/scheduled/fact-extraction Queue+Workers in ai-worker, multiTagState queue + JobFailureListener QueueEvents + releaseDm worker in bot-client) — a helper only new code uses is a 12th pattern, not a standard. The migration audit is where the value lives: genuine divergences (DM worker's `concurrency: 1`, fact-extraction's budget options) become named overrides; accidental drift (mismatched history limits, missing event handlers) dies. **Promote when**: the next new Queue/Worker construction site appears — build the helper THEN migrate everything in that same PR.

