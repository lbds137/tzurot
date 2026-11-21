---
id: TASK-1494
title: >-
  Error objects logged as err may carry raw attachment URLs past
  no-raw-log-content
status: To Do
assignee: []
created_date: '2026-11-21T04:28:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1494000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: cross-family review of the TASK-1385 PR. A converted site logs { err, urlShape }; if the error came from a fetch/HTTP client or our own throw that embeds the request URL (message, cause, request metadata), pino serializes it raw. The rule covers Error constructors only where the URL is an attachment-ish member read; a URL held in a bare parameter (fetchUrl, url) inside a throw is invisible. Unverified: no site confirmed yet.

What: sweep throws and rejections on the attachment fetch paths (git grep -n "new .*Error(" in services/ai-worker/src/utils/attachmentFetch.ts, multimodal/AudioProcessor.ts, VisionProcessor.ts, DownloadAttachmentsStep.ts, and bot-client voice paths) for a URL in the message or cause; convert any to attachmentUrlShape. Add one emitted-record test: a failing download whose filename and query carry sentinel strings, asserting neither appears in the serialized log record (err included).

Acceptance: the sweep result recorded here (N sites, M converted) and the emitted-record test green.
<!-- SECTION:DESCRIPTION:END -->
