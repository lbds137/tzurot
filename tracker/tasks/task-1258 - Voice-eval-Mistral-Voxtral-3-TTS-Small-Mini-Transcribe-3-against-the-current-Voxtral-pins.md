---
id: TASK-1258
title: >-
  Voice eval: Mistral Voxtral 3 (TTS + Small/Mini Transcribe 3) against the
  current Voxtral pins
status: To Do
assignee: []
created_date: '2026-10-21 17:05'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1246000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (2026-10-21, "for later") passed on the Artificial Analysis writeup of the Voxtral 3 release. Mistral is the primary voice provider (BYOK), so a new generation from the same vendor is the cheapest possible upgrade: same key, same endpoints.

Claims from the writeup (third-party leaderboard, not verified here):
- STT: Voxtral Small Transcribe 3 is #3 on the AA leaderboard at 2.1% AA-WER; Mini Transcribe 3 is #5 at 2.2%; Mini Transcribe Realtime 3 scores 3.3% at 960 ms (down from 5.2% for the previous realtime model).
- TTS: Voxtral 3 TTS is #12 of 98 (provider voice, Elo 1218) and #12 of 43 (cloned voice, Elo 1068); pronunciation robustness 84.4%; priced at $13 per 1M characters.

Current pins (git grep on develop, 2026-10-21):
- STT: DEFAULT_MISTRAL_STT_MODEL = voxtral-mini-latest (services/ai-worker/src/services/voice/MistralSttClient.ts:49).
- TTS: bootstrap config pins voxtral-mini-tts-2603 (services/api-gateway/src/services/TtsConfigBootstrap.ts:34); the client fallback is voxtral-mini-tts-latest (MistralTtsClient.ts:308).
Unknown, to be probed: whether the -latest aliases already moved to the v3 models, and the exact v3 model ids (Mistral /v1/models).

What: (1) probe /v1/models for the v3 ids and alias targets; (2) STT: run the clips used for TASK-1187 through Mini Transcribe 3 and Small Transcribe 3 and record latency, cost per clip and verbatim fidelity; (3) TTS: render a fixed line set with a provider voice and a cloned voice on 2603 vs v3, check the 30 s reference-audio limit (packages/tooling/src/voice/audit-references.ts) still holds, and compare price per character with the current model; (4) bump the pins only where v3 wins. Standing rule: add engines beside the current ones, never drop a working one.

Related: TASK-1187 (Gemini 3.8 Flash as a second STT provider): run both evals on the same clip set.

Acceptance: a results note listing the model ids, numbers per model and the pin decision, and pins updated (or left alone, with the reason) in the same PR.
<!-- SECTION:DESCRIPTION:END -->
