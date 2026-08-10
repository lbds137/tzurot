---
id: TASK-512
title: Skip audio-transcription job creation for own-persona voice references
status: Done
assignee: []
created_date: '2026-08-10 21:44'
updated_date: '2026-08-10 22:54'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 512000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: jobChainOrchestrator.createAudioTranscriptionJobs (services/api-gateway/src/utils/jobChainOrchestrator.ts, per-refMsg loop ~line 349) dispatches one BullMQ STT job per reference voice attachment regardless of authorRole. TASK-511 (fix branch) guards the RENDER side, so an own-persona transcript never reaches the prompt - but the STT call itself still runs and is billed (or loads the self-hosted voice-engine) for references to our own personas. Found by the TASK-511 class sweep; recorded in the sttDispatchGuardCoverage allowlist entry for jobs/AudioTranscriptionJob.ts.
Fix shape: thread the reference authorRole into the audio-job params (AudioJobParams / AudioTranscriptionJobData) and skip job creation when authorRole is assistant. Fixture-sweep rule (02-code-standards s8) applies if the wire shape changes.
Acceptance: no audio-transcription job is enqueued for an assistant-authored reference; user/bot/absent behavior unchanged; the TASK-511 allowlist reason updated to cite the shipped fix.
<!-- SECTION:DESCRIPTION:END -->
