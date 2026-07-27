---
id: TASK-45
title: 'STT transcript'
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
labels:
  - 'area:ai-worker'
  - 'area:voice'
dependencies: []
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

STT transcript — word repetition + lost space across a boundary

**Why:** User-observed (2026-06-28) in a **Mistral/Voxtral**-attributed transcript: `"...how to do it.do it safely."` — "do it" repeats across what looks like a segment boundary AND the join dropped the inter-word space (`it.do`). NOTE this is the **Mistral** path, NOT the self-hosted Parakeet path whose chunk-stitching `_merge_overlap` (`voice-engine/server.py`) was fixed in #1369 — different provider. **RUNTIME-CONFIRMED** (prod ai-worker logs 2026-06-28 18:24 UTC, jobId `audio-d7e86857`, the screenshot transcription): a **single** Voxtral call (`modelId="voxtral-mini-latest"`, `attempt 1`, no chunking), and `chars=1654` is **identical** across `MistralSttClient` → `AudioProcessor` → `AudioTranscriptionJob` — i.e. the transcript is passed through byte-for-byte unchanged. So the repetition is **Voxtral's own raw output**, NOT our code (no stitching exists on the Mistral path). Investigation (a) "do we chunk for Mistral?" → answered: no. **Remaining decision (b)**: provider-agnostic post-transcription cleanup (collapse a repeated adjacent n-gram + normalize join spacing — would also harden the Parakeet path) — risky for legit repetition ("no no no") — vs. accepting it as BYOK Voxtral quality (or trying a different Voxtral model / reporting upstream). **Promote when**: transcription-quality reports recur, or when next touching the STT pipeline. Surfaced 2026-06-28 (user-reported; runtime-confirmed same day).
<!-- SECTION:DESCRIPTION:END -->
