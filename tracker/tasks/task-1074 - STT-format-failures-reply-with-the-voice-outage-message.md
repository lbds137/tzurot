---
id: TASK-1074
title: STT format failures reply with the voice-outage message
status: Done
assignee: []
created_date: '2026-09-24 05:53'
updated_date: '2026-09-26 04:49'
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

created: 2026-09-26 00:17
---
Grounding 2026-09-25 (driver, pre-dispatch; a Deck reboot stopped the unit before the spec was written; nothing dispatched). Code-read, verify before editing: (1) voice-engine server.py /v1/transcribe (~line 630) decodes via librosa.load on BytesIO; undecodable bytes raise soundfile LibsndfileError with no audioread fallback (comment at ~652); the only catch is the generic except at ~692 which answers 500. Existing 4xx: 413 (too long). Tests: services/voice-engine/tests/test_transcribe.py (413 at ~39, 503 at ~28, 500 at ~102). Fix: catch the decode error class and answer 415 with a detail string; pin with an undecodable-bytes fixture (plain non-audio bytes) so the test is a runtime probe of the exception class, not a mock. (2) ai-worker: VoiceEngineClient throws VoiceEngineError(status, detail) on any non-2xx (~76); isTransientVoiceEngineError (~253) retries only 502/503/504, so 415 is already non-retryable. The mechanism to COPY is the 413 sibling at AudioProcessor.ts:106, which maps VoiceEngineError status 413 to AudioTooLongError (common-types utils/errors.ts, name-based guard). Add AudioFormatError + isAudioFormatError beside it and map 415 the same way; check whether the Mistral STT fallback chain runs after a voice-engine terminal error and keep the 413 behaviour for 415. (3) Wire: SttFailureReason type at common-types types/jobs.ts:224 AND its Zod twin at jobs.ts:333 (both need the new member, e.g. unsupported_format); AudioTranscriptionJob.ts classifyFailureReason (~51) adds the branch; bot-client reconstructs a typed error from failureReason in utils/gatewayServiceCalls.ts:466-480 (add the branch there), and VoiceTranscriptionService.ts classifyTranscriptionErrorMessage (~58-69) renders the new message. Tests at each hop: VoiceEngineClient.test.ts (~54-122), AudioTranscriptionJob.test.ts describe blocks per reason (~198-313), VoiceTranscriptionService.test.ts (~800, ~816, ~1113), plus gatewayServiceCalls tests. Two-way sweep: the new 415 branch sits beside 413; enumerate every guard the 413 path applies (retry, fallback, usage row) and justify each omission. TASK-1112 shares AudioProcessor.ts prepareVoiceAudioForStt (~439) and voiceContainerSniff.ts resolveVoiceAudioLabel (~72, gated on isVoiceMessage) and the MultimodalProcessor.ts routing gate (~243: audio/ prefix OR isVoiceMessage); sequence 1112 after 1074.
---
<!-- COMMENTS:END -->
