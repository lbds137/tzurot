---
id: TASK-103
title: Pocket TTS quantize=True for memory savings
status: To Do
assignee: []
created_date: '2026-05-14 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:voice'
  - 'area:embeddings'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Pocket TTS `quantize=True` for memory savings

**Why:** pocket-tts 2.1+ exposes a `quantize: bool` arg in `TTSModel.load_model()` (requires `pocket-tts[quantize]` extra → torchao). Docstring claims ~48% memory reduction + ~27% speed improvement on x86 (FBGEMM). **Probed 2026-05-14 on Sapphire Rapids 8581C with separate-process measurement (kernel-tracked peak RSS to avoid Python allocator confounds): peak RSS 1259MB → 1247MB = ~1% reduction; generation RTF 0.575 → 0.658 = +14% slower.** Net-negative for Railway billing (vCPU-time goes up more than memory-time goes down). Likely cause: docstring's "48%" measures transformer-layer weights (attention + FFN — what int8 quantization targets) which are a small fraction of total process RSS (Mimi codec, text tokenizer, voice embeddings, PyTorch runtime dominate); plus torchao 0.17.0 emits deprecation warnings suggesting it may not be hitting FBGEMM on this hardware. Quality preserved per user A/B (Emily + ha-shem refs). **Promote when**: actual Railway memory pressure surfaces (OOM kills, needing tier upgrade), OR a future pocket-tts release ships a quantize implementation that delivers process-level memory savings on commodity x86 (changelog mentioning Sapphire Rapids / AVX-512 specifically would be a re-probe trigger). Surfaced 2026-05-14 PR #1029 follow-up. Deferred 2026-05-14.
<!-- SECTION:DESCRIPTION:END -->
