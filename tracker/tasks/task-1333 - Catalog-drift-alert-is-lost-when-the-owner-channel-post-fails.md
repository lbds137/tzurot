---
id: TASK-1333
title: Catalog drift alert is lost when the owner-channel post fails
status: To Do
assignee: []
created_date: '2026-11-01T11:33:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1316000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: post-merge audit, verified by reading. services/bot-client/src/services/catalogAlert/setupCatalogDriftAlertWorker.ts returns normally when postOwnerChannelEmbed returns false, so the queue retries never run, and the sentinel blocks a re-alert until the model resolves again. The file header records this as a deliberate trade-off, and PR 2632 closed only the enqueue half.
What: throw on a failed post when the channel is configured, so BullMQ retries; keep the silent no-op when FEEDBACK_CHANNEL_ID is unset. Also clear fallthroughTriggered on the quota retarget in services/ai-worker/src/jobs/handlers/pipeline/steps/AuthStep.ts, where the footer can add no coding plan key to the admin default model (cosmetic, same unit for convenience).
Acceptance: a failed post retries and a test pins it; retargeted footer omits the suffix.
<!-- SECTION:DESCRIPTION:END -->
