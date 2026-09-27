---
id: TASK-1123
title: >-
  Privacy policy says only voice messages are transcribed; attached audio files
  are too
status: To Do
assignee: []
created_date: '2026-09-27 10:41'
labels:
  - 'area:legal'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `docs/legal/PRIVACY_POLICY.md` (the third-party processors list: the Mistral / ElevenLabs line and the self-hosted voice engine line) describes transcription as receiving your "voice-message audio" and says "your voice messages are transcribed". The bot also transcribes audio FILES attached to a message: any `audio/*` attachment already did before beta.232, and from beta.232 (#2545) so does a plain `video/webm` upload whose bytes are audio-only. So the policy under-describes what audio reaches the transcription providers. Found in the beta.232 release doc sweep (2026-09-27). The getting-started guide was corrected in the same sweep.

Owner question: should the privacy policy say "voice messages and audio files you attach" wherever it says voice messages are sent for transcription?

Recommendation: yes. Widen both lines to "voice messages and attached audio files". It matches shipped behaviour, adds no new processor, and legal accuracy is cheap now and costly if it's ever questioned.

Acceptance: the owner's wording lands in PRIVACY_POLICY.md (it renders live at /privacy), or the owner records why the current wording stands.
<!-- SECTION:DESCRIPTION:END -->
