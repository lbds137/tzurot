---
id: TASK-1338
title: Failed-job handlers claim a retry on the final attempt
status: To Do
assignee: []
created_date: '2026-11-01T23:39:00Z'
labels:
  - area:bullmq
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1321000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: four BullMQ failed handlers log "BullMQ will retry" on every failure, including the last, after which the job is dropped, so a real drop reads as a transient failure in logs. Sites: services/ai-worker/src/jobs/archiveSummarySetup.ts and factExtractionSetup.ts, services/bot-client/src/services/releaseDm/setupReleaseDmWorker.ts and retentionNotice/setupRetentionNotifyWorker.ts, all grep "BullMQ will retry". Raised by claude-review on PR 2693, which fixes the same line in setupCatalogDriftAlertWorker.ts. attemptsMade already counts the failure when the failed event fires (bullmq job.js moveToFailed, then worker.js emit).
What: branch on job.attemptsMade >= (job.opts.attempts ?? 1) and log a distinct error-level dropped line at each site, or share a helper if the shape holds.
Acceptance: each site logs the dropped line on its final attempt, and a test pins it.
<!-- SECTION:DESCRIPTION:END -->
