---
id: TASK-1167
title: >-
  Evaluate Cactus Whistle (16.9 MB CPU speech-to-text) as an additional STT
  engine
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04: Cactus "Whistle" STT - a 16.9 MB CPU speech-to-text model, said to beat Whisper base while 9x smaller and 6x faster, languages EN, DE, FR, ES, IT, NL, PL (from a tweet by @cactuscompute; figures are the vendor claims, NOT verified - find the model card, license and benchmark source before relying on any of it). Standing owner rule (voice stack): add engines alongside existing providers, never replace. Sibling evaluation: TASK-784 (Gemini 3.5 Transcribe as a STT option, same deliverable shape); voice-engine ASR follow-ups live in doc-94 (TASK-181).
What: evaluation only. Check license, runtime (can it run in the Python voice-engine, services/voice-engine, on CPU), language coverage versus the languages our users send voice notes in (7 listed languages is narrow versus the current ASR), accuracy on a few real persona-chat voice notes versus the current self-hosted path, and latency/RAM versus the current engine.
Acceptance: a written recommendation (adopt as an additional engine / watch / rule out) with license, language gap and a quality spot-check, recorded on this task or a linked idea doc. No code.
<!-- SECTION:DESCRIPTION:END -->
