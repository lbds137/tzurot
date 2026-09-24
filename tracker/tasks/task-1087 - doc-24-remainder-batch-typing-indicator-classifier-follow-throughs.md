---
id: TASK-1087
title: 'doc-24 remainder batch: typing-indicator classifier follow-throughs'
status: To Do
assignee: []
created_date: '2026-09-24 21:13'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1080000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: doc-24 (Typing Indicator Reliability) shipped its classifier and then lost its slot in April 2026; the 2026-09-24 half-finished sweep found the remainder unnamed anywhere. Converted from an epic remainder into a drain batch by owner ruling 2026-09-24.
Members (from the theme doc): (1) route the VoiceTranscriptionService initial sendTyping through typingErrorClassifier; (2) respect retryAfterSeconds in the typing-indicator backoff; (3) the log-driven investigation (per-channel dropout aggregation over prod logs; local lane, Railway needed).
Fix shape: (1) and (2) are one PR, cloud-eligible; (3) is a read-only prod-log unit that either closes the theme or files what it finds.
Acceptance: (1) and (2) merged with tests pinning the classifier call and the backoff honouring retryAfterSeconds; (3) recorded on the theme doc; doc-24 then closes or names its next trigger.
<!-- SECTION:DESCRIPTION:END -->
