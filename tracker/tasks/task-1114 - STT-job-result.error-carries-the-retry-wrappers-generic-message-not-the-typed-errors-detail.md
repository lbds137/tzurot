---
id: TASK-1114
title: >-
  STT job result.error carries the retry wrapper's generic message, not the
  typed error's detail
status: To Do
assignee: []
created_date: '2026-09-26 04:47'
labels:
  - 'area:ai-worker'
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 3 on PR #2544. For a typed STT failure (AudioTooLongError, UnsupportedAudioFormatError, TimeoutError), services/ai-worker/src/jobs/AudioTranscriptionJob.ts sets result.error from the outer RetryError, whose message is the generic "... failed with non-retryable error", so the job result and bot-client never see the real detail (for example "Voice engine request failed (415): Audio format not recognised"). The user reply is unaffected, because it is keyed on failureReason and the typed error, not the message. The gap is diagnostic: the one field meant to carry the cause carries the wrapper text, and no test pins result.error content.
What: set result.error from the unwrapped root cause (the same root classifyFailureReason already reads), and add a seam-test assertion (audioTranscriptionFailureSeam.test.ts) on result.error for the 415 and 413 cases.
Acceptance: a real 415 through the seam test yields result.error containing "Audio format not recognised"; a mutation back to the wrapper message reddens it.
<!-- SECTION:DESCRIPTION:END -->
