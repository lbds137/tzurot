# Open-Source Voice Engine Research

> **Date**: 2026-01-24 (initial), 2026-03-01 (updated)
> **Status**: Implemented — Phases 1–4.6 shipped (v3.0.0-beta.89–90)

## TL;DR

Two-tier voice system for both STT and TTS:

| Tier                   | STT                         | TTS               |
| ---------------------- | --------------------------- | ----------------- |
| **Free (self-hosted)** | NVIDIA Parakeet TDT 0.6B v3 | Kyutai Pocket TTS |
| **Premium (BYOK)**     | ElevenLabs Scribe v2        | ElevenLabs v3     |

Self-hosted models run as a Python FastAPI microservice (`services/voice-engine/`) on Railway CPU in Serverless mode (~$5-10/month vs $42/month always-on). Premium users bring their own ElevenLabs API key for both STT and TTS.

## Key Decisions (Updated from Initial Research)

| Decision          | Initial (Jan 2026)   | Updated (Mar 2026)            | Why                                                                           |
| ----------------- | -------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| STT model         | SenseVoice (Alibaba) | **Parakeet TDT 0.6B v3**      | Better punctuation (trained-in, not post-processing), 6.05% WER, 25 languages |
| TTS model         | Kyutai Pocket TTS    | Kyutai Pocket TTS (confirmed) | True zero-shot cloning, 100M params, CPU-optimized                            |
| TTS alternative   | Kokoro-82M           | Rejected                      | No voice cloning capability — preset voices only                              |
| Deployment        | Always-on            | **Railway Serverless**        | $5-10/month vs $42/month; 30-60s cold start acceptable                        |
| OpenAI dependency | None                 | None (confirmed)              | Self-hosted + ElevenLabs covers all tiers                                     |

## Critical Warnings

The initial Gemini consultation (Jan 2026) produced fabricated API names for Pocket TTS. The correct library is `pocket_tts` with `TTSModel.load_model()`. See the implementation guide for verified API usage.

## Implementation

The voice engine is fully implemented across the codebase:

- **Python service**: `services/voice-engine/` (FastAPI, Parakeet TDT STT, Pocket TTS)
- **ai-worker integration**: `services/ai-worker/src/services/voice/` (VoiceEngineClient, ElevenLabsClient, ElevenLabsVoiceService, VoiceRegistrationService)
- **Pipeline step**: `services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts`
- **API routes**: `services/api-gateway/src/routes/user/voices.ts`, `voiceModels.ts`
- **Bot commands**: `/character voice`, `/settings voices`
- **Config cascade**: `elevenlabsTtsModel` field for user-selectable TTS model

## Alternatives Considered

| Model            | Quality    | Speed    | CPU     | Cloning        | Verdict                            |
| ---------------- | ---------- | -------- | ------- | -------------- | ---------------------------------- |
| Kokoro-82M       | ⭐⭐⭐     | ⭐⭐⭐⭐ | ✅      | ❌ Preset only | Rejected — no cloning              |
| F5-TTS           | ⭐⭐⭐⭐   | ⭐⭐⭐   | ❌ GPU  | ✅             | Too heavy for Railway              |
| XTTS v2          | ⭐⭐⭐     | ⭐⭐     | ✅      | ✅             | Older, less accurate               |
| NeuTTS Air       | ⭐⭐⭐⭐   | ⭐⭐⭐   | ✅      | ✅             | Future upgrade path (multilingual) |
| Chatterbox Turbo | ⭐⭐⭐⭐⭐ | ⭐⭐⭐   | ❌ GPU  | ✅             | Future if GPU available            |
| Qwen3-TTS        | ⭐⭐⭐⭐⭐ | ⭐⭐     | ⚠️ Slow | ✅             | Highest quality, needs GPU         |

## References

- Backlog: BACKLOG.md → Future Themes → Voice Engine
- Pocket TTS GitHub: https://github.com/kyutai-labs/pocket-tts
- Parakeet TDT HuggingFace: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
