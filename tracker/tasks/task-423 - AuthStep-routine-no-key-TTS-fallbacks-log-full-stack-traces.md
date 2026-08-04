---
id: TASK-423
title: AuthStep routine no-key TTS fallbacks log full stack traces
status: Done
assignee: []
created_date: '2026-08-04 02:51'
updated_date: '2026-08-04 07:54'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 423000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod sweep 2026-08-04 — every TTS job for a non-BYOK user emits ElevenLabs key resolution failed AND Mistral key resolution failed at INFO, each with a full err stack trace (85 lines/6h, mostly one user). The fallback is expected control flow (closed provider, no BYOK key); stack traces make it read as an incident and bulk the logs.

Fix shape: in AuthStep resolveAudioProviderKeys, when the error is the known no-key-available case, log one line with provider + userId and NO err object (or demote to debug); keep the full err for unexpected resolution failures.

Acceptance: a non-BYOK TTS request logs at most one compact fallback line per provider; unexpected errors still carry stacks.
<!-- SECTION:DESCRIPTION:END -->
