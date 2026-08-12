---
id: TASK-556
title: >-
  Request dedup entry is written after job creation - deploy-window retry can
  double-bill
status: To Do
assignee: []
created_date: '2026-08-12 22:32'
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
<!-- SECTION:DESCRIPTION:END -->
