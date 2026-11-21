---
id: TASK-1493
title: >-
  DownloadAttachmentsStep failure string carries the raw filename or URL into
  logs and the reply spoiler
status: To Do
assignee: []
created_date: '2026-11-21T04:24:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1493000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found at the TASK-1385 PR read. services/ai-worker/src/jobs/handlers/pipeline/steps/DownloadAttachmentsStep.ts builds failures.push with label/attachments[i].name ?? attachments[i].url (grep token: failures.push). The string is logged via { failure } and thrown in an Error whose text users see in the bot reply spoiler, so a user-supplied filename (or a CDN URL ending in it) reaches logs. no-raw-log-content cannot see it: the read goes through a computed member (attachments[i]).

What: give the failure a structured shape (index, filenameShape, attachmentUrlShape) for the log line; decide separately what the spoiler shows the user (their own filename may be fine to show them, never to the logs).

Acceptance: a test feeds a failing download of a named attachment and asserts the logged fields carry no filename stem; the spoiler text is pinned by its own test.
<!-- SECTION:DESCRIPTION:END -->
