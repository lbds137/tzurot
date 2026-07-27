---
id: TASK-267
title: 'Shapes.inc voice import'
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 267000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Shapes.inc voice import — locate the voice data, then build step 7.5 — shapes.inc has a user-visible voice feature (owner-confirmed 2026-07-13, overriding the 2026-07-09 competitive research which under-reported it), but our fetcher's four endpoints expose no known voice fields — so imported characters currently lose their voice. **Fix shape**: first identify where the voice data lives (grep a fresh raw JSON export for voice/audio/tts keys — post-#1630 exports pass all fields through verbatim; if absent, probe for an unfetched voice endpoint), then build the pre-designed import step 7.5: clone `downloadAndStoreAvatar` (`ShapesImportHelpers.ts`) into `downloadAndStoreVoiceReference` writing `Personality.voiceReferenceData`/`voiceReferenceType` + `voiceEnabled: true`; lazy register/clone fires automatically via `VoiceRegistrationService.ensureVoiceRegistered` — no provider wiring needed. **Promote when**: a voice field/endpoint is identified in live shapes.inc data. Surfaced at voice-engine theme close-out 2026-07-13 (owner decision).

**Why:** Building against guessed field shapes is the class of work this project refuses; the data shape is the gate.
<!-- SECTION:DESCRIPTION:END -->
