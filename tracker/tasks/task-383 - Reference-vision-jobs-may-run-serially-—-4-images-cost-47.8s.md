---
id: TASK-383
title: Reference vision jobs may run serially — 4 images cost 47.8s
status: To Do
assignee: []
created_date: '2026-08-01 00:13'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 383000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced in TASK-367's filing (2026-07-30), carried forward when 367 shipped without it (#1883).**

The investigation that produced TASK-364/365/367 observed 4 reference images taking **47.8s** total, which reads as serial dispatch. `processAttachmentsParallel` uses `Promise.allSettled`, so the fan-out is parallel WITHIN a reference — the suspect is upstream: the per-image ImageDescription child jobs the bot enqueues, and how BullMQ concurrency drains them.

**Verify before fixing.** This is a code-read hypothesis, not a runtime-confirmed mechanism. Pull a prod job with 3+ reference images and compare each child job's start timestamp. Staggered by roughly one description-latency each → queue concurrency is the cause. Overlapping → the 47.8s was one slow model call and there is nothing here.

**Fix shape (if confirmed):** raise the image-description worker concurrency, or batch a reference's images into one child job.

**Acceptance:** timestamps from a real multi-image job, and either a concurrency change with a before/after latency figure, or an archived task carrying the disproving data.
<!-- SECTION:DESCRIPTION:END -->
