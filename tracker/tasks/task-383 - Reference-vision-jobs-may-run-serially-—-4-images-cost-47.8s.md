---
id: TASK-383
title: Reference vision jobs may run serially — 4 images cost 47.8s
status: Done
assignee: []
created_date: '2026-08-01 00:13'
updated_date: '2026-08-02 03:03'
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

## DISPROVEN 2026-08-01 — archived with the data, per this task's own acceptance

Measured across 10 real multi-image prod jobs (ai-worker, 10-deployment sweep)
against a 27-job single-image baseline (median 28,924 ms).

| images | actual | if SERIAL (n x median) | ratio |
| ---: | ---: | ---: | ---: |
| 2 | 38,829 | 57,848 | 0.67 |
| 2 | 62,240 | 57,848 | 1.08 |
| 2 | 88,853 | 57,848 | 1.54 |
| 3 | 39,260 | 86,772 | 0.45 |
| 3 | 51,490 | 86,772 | 0.59 |
| 3 | 82,840 | 86,772 | 0.95 |
| **4** | **47,774** | 115,696 | **0.41** |
| 5 | 63,688 | 144,620 | 0.44 |
| 6 | 36,542 | 173,544 | 0.21 |
| 9 | 76,663 | 260,316 | 0.29 |

**Pearson r(imageCount, duration) = 0.066.** No correlation. Nine images ran in
76.7 s — 29% of what serial dispatch predicts; six ran in 36.5 s, the FASTEST of
every multi-image job measured and barely above the single-image median. A
2-image job took 88.9 s, slower than the 9-image one. That is per-call variance,
not serialization.

**And the headline number was never anomalous**: a SINGLE-image job in the same
window took 50,524 ms — longer than the 47,774 ms that prompted this task.

So the task's own disproving condition is met: _"Overlapping -> the 47.8s was one
slow model call and there is nothing here."_

**Two premises in the task above were also wrong**, recorded so the reasoning is
not repeated:

1. **There are no per-image child jobs to stagger.** api-gateway's
   `createImageDescriptionJob` builds ONE `ImageDescription` job per reference
   carrying ALL its images (an `imageAttachments` array) — which is why the prod
   line reads `imageCount=4` on a single job. The suggested check ("compare each
   child job's start timestamp") had nothing to compare.
2. **The fan-out was already parallel.** `ImageDescriptionJob` processes with
   `await Promise.all(attachments.map(processSingleImage))`. The suspicion that
   dispatch was serial upstream was checkable in one read.

**Fix shape retired**: raising image-description worker concurrency would not have
helped, and batching a reference's images into one child job is what already
happens.
<!-- SECTION:DESCRIPTION:END -->
