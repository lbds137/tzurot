---
id: TASK-1125
title: Transcript cache is checked only after the plain-webm sniff downloads the file
status: To Do
assignee: []
created_date: '2026-09-27 13:22'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: both plain audio-only webm paths (`MultimodalProcessor.ts` trigger upload, TASK-1112; `AttachmentProcessor.ts` `processPlainFileAttachment`, TASK-1116) call `sniffPlainWebmForAudioOnly`, which fetches up to PLAIN_WEBM_SNIFF_MAX_BYTES (25 MiB), before `transcribeAudio` consults the Redis transcript cache. A repeat reference to an already-transcribed plain webm pays the full download before the cache hit. Raised by claude-review on PR 2548 round 3.

What: measure first (how often a plain webm is referenced more than once; the cache key and hit rate), then, if it earns it, consult the transcript cache by URL/attachment id before the sniff in both call sites, falling back to the sniff on a miss.

Acceptance: a cached plain webm transcript is served with zero fetches on both paths, pinned by a test per path; or a recorded measurement showing the repeat rate is too low to matter, with the task closed on that data.
<!-- SECTION:DESCRIPTION:END -->
