---
id: TASK-130
title: 'Make /admin db-sync an async job instead of a synchronous HTTP request'
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
labels:
  - 'area:jobs'
dependencies: []
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make `/admin db-sync` an async job instead of a synchronous HTTP request

**Why:** `db-sync` scans every table and flushes cross-environment writes, so its duration scales with data (observed ~11s on dev). It's a synchronous `ownerClient.dbSync` call the bot waits on, bounded by the route's `timeoutMs`. The dissolution-era smoke bumped that 10s→30s (`GATEWAY_TIMEOUTS.BULK_OPERATION`) to stop the false-timeout, but a fixed synchronous HTTP timeout is fundamentally a band-aid for a long-running operation — same anti-pattern as the `transcribe` long-poll. The manifest caps `timeoutMs` at 60s, so there's no room to keep raising it. **Correct fix**: model db-sync like AI generation — submit a BullMQ job, return a job ID immediately, deliver the result (stats summary) via the existing result-stream / a follow-up edit, so the operation's duration is decoupled from any HTTP timeout. Owner-only tool, rarely run, so this is YAGNI until it actually needs it. **Promote when**: db-sync approaches/exceeds the 30s budget again (a real timeout recurrence), OR the sync set grows enough that the operation is routinely >15s. Surfaced 2026-05-30 during beta.126 dev smoke (db-sync reported "Request timeout (HTTP 0)" at 10s while the gateway completed the sync ~0.8s later). Deferred 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->
