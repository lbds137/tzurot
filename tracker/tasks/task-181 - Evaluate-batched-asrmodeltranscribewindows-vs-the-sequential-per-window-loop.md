---
id: TASK-181
title: >-
  Evaluate batched asr_model.transcribe([...windows]) vs the sequential
  per-window loop
status: To Do
assignee: []
created_date: '2026-06-27 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 181000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Evaluate batched `asr_model.transcribe([...windows])` vs the sequential per-window loop

**Why:** The voice-engine chunked path (`_transcribe_chunks`, `services/voice-engine/server.py`) transcribes windows ONE AT A TIME under `_asr_inference_lock` — deterministic memory, version-independent. NeMo _may_ accept a batch of windows in one `.transcribe()` call (potentially faster), but batch memory/parallelism is version-specific and could OOM the 4GB box. **Fix shape**: benchmark batched vs sequential per-window inference time + peak RSS on Railway CPU; switch only if the speedup is real and memory stays bounded. **Promote when**: prod `per_chunk_sec` logs show the sequential loop is the latency bottleneck for long audio, OR a measurement pass is run. Surfaced 2026-06-27 by the long-audio STT chunking work (beta.139).
<!-- SECTION:DESCRIPTION:END -->
