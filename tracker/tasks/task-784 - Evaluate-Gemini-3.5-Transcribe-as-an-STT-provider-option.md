---
id: TASK-784
title: Evaluate Gemini 3.5 Transcribe as an STT provider option
status: To Do
assignee: []
created_date: '2026-08-27 14:25'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 784000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner flagged the launch announcement for later evaluation (2026-08-27). Google Gemini 3.5 Transcribe: 85+ languages with auto-detection, WER 4.0% streaming / 2.6% non-streaming (Artificial Analysis), diarization up to 3 speakers with timestamps, filler-word removal and auto-formatting, custom vocabulary, 70% faster time-to-final vs prior model. Public preview: gemini-3.5-transcribe (Interactions API, pre-recorded) and gemini-3.5-transcribe-live (Live API, realtime). Pricing and audio-length limits not stated in the announcement.

Source: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5-transcribe/

Fix shape: evaluation, not adoption — compare against the current STT path (user STT override cascade falling back to the self-hosted voice-engine) on accuracy for persona-chat voice notes, pricing once published, and whether the ai-worker already holds a Gemini key that covers it. Per the voice-stack posture, a new engine adds alongside existing providers, never replaces.

Acceptance: a written recommendation (adopt as provider option / watch / rule out) with pricing and a quality spot-check, recorded here or in a linked idea doc.
<!-- SECTION:DESCRIPTION:END -->
