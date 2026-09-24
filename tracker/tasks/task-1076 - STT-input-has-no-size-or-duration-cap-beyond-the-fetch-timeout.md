---
id: TASK-1076
title: STT input has no size or duration cap beyond the fetch timeout
status: To Do
assignee: []
created_date: '2026-09-24 06:57'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1069000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: fetchAudioBuffer (services/ai-worker/src/services/multimodal/AudioProcessor.ts:63) validates the URL and aborts on TIMEOUTS.AUDIO_FETCH, with no byte-size or duration cap, so any attachment classified as voice goes to STT whole. #2499 (TASK-1069) made the Discord IsVoiceMessage flag sufficient with a duration, whatever the content type. A modified client that sets the flag on a large video/webm can have it transcribed; the same trust model already held for a spoofed audio/* attachment with a duration (claude-review round 2 on #2499). The WebM remux is bounded by runFfmpeg (30 s timeout, 50 MB stdout cap in services/ai-worker/src/services/voice/audioNormalizer.ts); the fetch and the STT call are not. The resource at risk is free-tier voice-engine compute and BYOK spend.
Fix shape: a byte-size cap on the fetched voice buffer (Content-Length check plus a streamed byte limit) and a duration cap from the attachment metadata, both as named constants, refusing with a clear non-retryable failure before any STT call.
Acceptance: an over-cap voice attachment is refused before STT, with a test at each cap.
Promote when: voice-engine load or STT spend from oversized voice attachments is observed.
<!-- SECTION:DESCRIPTION:END -->
