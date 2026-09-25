---
id: TASK-1074
title: STT format failures reply with the voice-outage message
status: To Do
assignee: []
created_date: '2026-09-24 05:53'
updated_date: '2026-09-25 22:47'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1067000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: voice-engine /v1/transcribe (services/voice-engine/server.py:630) answers 500 for audio its decoder cannot read. isTransientVoiceEngineError (services/ai-worker/src/services/voice/VoiceEngineClient.ts:253) retries only 502/503/504, so the job fails as unavailable and bot-client replies with the outage text at services/bot-client/src/services/VoiceTranscriptionService.ts:66 (temporarily unavailable, retried several times), which is wrong for a format failure. Surfaced by the TASK-1069 probe: libsndfile rejects WebM read from BytesIO with Format not recognised. Only the decoder failure was probed at runtime; the 500 and the chain after it are code-read by the TASK-1069 orchestrator, not runtime-confirmed. TASK-1069 remuxes WebM to Ogg in ai-worker, so the known trigger is its remux-failure fallback; any other undecodable upload hits the same message.
Fix shape: voice-engine answers 415 or 422 for an undecodable body; ai-worker maps that to a distinct non-retryable failure reason (for example unsupported-format); bot-client renders a could-not-read-this-audio-format reply instead of the outage text.
Acceptance: an undecodable voice attachment produces the format reply, not the outage reply, with a test pinning the mapping at each hop.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-25 22:47
---
Owner ruling 2026-09-25: scheduled for beta.232 (listed in backlog/now.md horizon). Context: the owner hit this exact misreport on prod the same day - a Vencord voice message the voice-engine could not decode (TASK-1069 follow-up) was answered with the voice-outage message. The transcode fix removes that instance; this task fixes the message class.
---
<!-- COMMENTS:END -->
