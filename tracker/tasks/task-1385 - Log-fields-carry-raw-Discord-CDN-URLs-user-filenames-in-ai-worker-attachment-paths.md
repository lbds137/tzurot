---
id: TASK-1385
title: >-
  Log fields carry raw Discord CDN URLs (user filenames) in ai-worker attachment
  paths
status: To Do
assignee: []
created_date: '2026-11-10T12:02:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1368000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Discord CDN attachment URLs embed the user-supplied filename in their path, and 00-critical.md forbids logging user-supplied filenames (urlPrefix in packages/common-types/src/utils/logContentPreview.ts is the sanctioned form). The lint rule no-raw-log-content only catches .name-style reads, so these pass CI. Surfaced by the pre-PR review of the TASK-1381/1383 branch.

What: route the url fields through urlPrefix (or drop them where requestId/jobId suffices) at services/ai-worker/src/services/AttachmentProcessor.ts (the own-voice, preprocessed-transcript and Transcribing audio attachment logs in processVoiceAttachment), services/ai-worker/src/jobs/ImageDescriptionJob.ts (~256), services/ai-worker/src/jobs/handlers/pipeline/steps/DownloadAttachmentsStep.ts (~293-297, originalUrl). Sweep ai-worker and api-gateway for other url: fields in logger calls (git grep -n "url: attachment" and "originalUrl" inside logger calls) before fixing; consider extending the lint rule to flag attachment url reads in log fields.

Acceptance: no logger call in the swept paths logs a full attachment URL; a test or lint rule pins the class.
<!-- SECTION:DESCRIPTION:END -->
