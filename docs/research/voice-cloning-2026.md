# Open-Source Voice Engine Research

> **Date**: 2026-01-24 (initial), 2026-03-01 (updated), 2026-05-01 (TTS Upgrade Epic decisions)
> **Status**: Phases 1–4.6 shipped (v3.0.0-beta.89–90); TTS Engine Upgrade Epic active — see "2026-05-01 TTS Upgrade Decision" section

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

## 2026-05-01 TTS Upgrade Decision

ElevenLabs spend (~$200/mo) drove the active TTS Engine Upgrade epic. Today's deeper research synthesized OpenRouter's TTS catalog, CPU-only candidates beyond Kyutai, and architectural shape. Decisions below.

### OpenRouter TTS catalog (verified 2026-05-01 via `/api/v1/models?output_modalities=speech`)

| Model                                 | $/1M chars       | Voice cloning               | Reference audio     | Notes                                                        |
| ------------------------------------- | ---------------- | --------------------------- | ------------------- | ------------------------------------------------------------ |
| `openai/gpt-4o-mini-tts-2025-12-15`   | $0.60            | ❌ Preset only              | —                   | OpenAI voices                                                |
| `hexgrad/kokoro-82m`                  | $0.62            | ❌ Preset only              | —                   | 8 languages                                                  |
| `mistralai/voxtral-mini-tts-2603` ⭐  | $16              | ✅ Zero-shot                | **3-30s**           | Beats ElevenLabs Flash v2.5 in 68.4% blind tests; matches v3 |
| `zyphra/zonos-v0.1-transformer`       | $7               | ✅ Zero-shot                | 10-30s              | Most controllable per Inferless eval                         |
| `zyphra/zonos-v0.1-hybrid`            | $7               | ✅ Zero-shot                | 10-30s              | SSM hybrid variant                                           |
| `sesame/csm-1b`                       | $7               | ⚠️ Quality mixed            | sample + transcript | "Decent but not perfect" per third-party                     |
| `canopylabs/orpheus-3b-0.1-ft`        | $7               | ❌ 7 presets                | —                   | Natural prosody                                              |
| `google/gemini-3.1-flash-tts-preview` | $20/M output tok | ⚠️ "Audio Profiles" unclear | —                   | 70+ languages, SynthID                                       |
| ElevenLabs (legacy)                   | ~$110            | ✅                          | flexible            | Status quo, $200/mo bleed                                    |

### Self-hosted CPU candidates (re-surveyed 2026-05-01)

| Model                         | RTF on CPU                   | RAM          | Voice cloning | Reference audio          |
| ----------------------------- | ---------------------------- | ------------ | ------------- | ------------------------ |
| Pocket TTS / Kyutai (current) | viable                       | low          | ✅            | flexible                 |
| **NeuTTS Air** ⭐ (Neuphonic) | **<0.5 on Intel i5 / RPi 5** | 400-600MB Q4 | ✅            | 3-15s, 85-95% similarity |
| Kokoro 82M                    | <0.3s/text                   | tiny         | ❌            | —                        |
| Piper                         | RPi-class                    | tiny         | ❌            | —                        |
| **Chatterbox Turbo**          | **NOT viable on CPU**        | —            | ✅            | (GPU required)           |

**Chatterbox CPU verdict** (settled 2026-05-01): even on RTX 3090 GPU it's 2.75× slower than real-time per community reports. Turbo variant only achieves RTF 0.499 on RTX 4090. CPU on Railway-class hardware is documented as "technically possible but not practical for real-time applications." Drops Chatterbox from active consideration; NeuTTS Air takes its place as the cloning-capable self-hosted candidate.

### Decisions

| Decision                | Choice                                                            | Rationale                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BYOK provider (Phase 1) | **Voxtral**                                                       | Strongest external benchmarks (blind beats EL Flash); 3-30s reference range covers existing audio library; 85% cost reduction |
| Free-tier engine        | **Keep Kyutai (current), ADD NeuTTS Air**                         | Additive design; remove Kyutai later only if NeuTTS Air clearly dominates in hands-on eval                                    |
| Future BYOK options     | Add Zonos / Gemini / others as OpenRouter expands                 | Architecture should make these cheap to plug in                                                                               |
| Reference audio storage | **Keep existing api-gateway `/voice-references/{slug}` endpoint** | Already implemented; works for both self-hosted and ElevenLabs paths today                                                    |
| Architecture order      | **Abstraction first, then engines**                               | User explicit preference: "build the abstraction so we can scale later"                                                       |

### Architecture findings

The codebase already has the abstraction in shape — just not in name. `VoiceRegistrationService` (self-hosted) and `ElevenLabsVoiceService` (BYOK) are parallel implementations of the same lifecycle pattern: lazy register/clone, 30min positive cache, 5min negative cache, in-flight dedup. Both consume the same `fetchVoiceReference(slug)` helper hitting `api-gateway:/voice-references/{slug}`. The ElevenLabs service additionally implements slot-eviction ("musical chairs") to handle the cloned-voice quota.

The work is therefore **extract + generalize + add Voxtral**, not "build from scratch." See `services/ai-worker/src/services/voice/` — both services already follow the pattern; the missing piece is a `TtsProvider` interface + config-driven routing in `TTSStep`.

### Phased plan

**Phase 1** _(single PR — 1-2 evenings)_: TTS preset infrastructure + Voxtral as first new provider.

- New `tts_configs` table mirroring `llm_configs` cascade
- New `TtsConfigResolver` (cascade: user-default → personality-default → global-default)
- Extract `TtsProvider` interface from existing services
- Refactor `ElevenLabsVoiceService` → `ElevenLabsTtsProvider` (slot-eviction logic intact)
- Refactor `VoiceRegistrationService` → `SelfHostedTtsProvider`
- Add `OpenRouterTtsProvider` (Voxtral via `/audio/speech`); zero-shot cloning means no slot management
- TTSStep dispatches via resolver instead of hardcoded BYOK-vs-self-hosted check
- Settings UX: `/settings tts ...` parallel to `/settings preset ...`

**Phase 2** _(separate PR)_: NeuTTS Air integration.

- Voice-engine server.py grows NeuTTS Air alongside Pocket TTS / Kyutai (additive)
- TTS preset gains `selfHostedEngine: 'kyutai' | 'neutts-air'` sub-field
- Hands-on quality eval — if NeuTTS Air clearly dominates, Phase 2.5 deprecates Kyutai

**Phase 3** _(deferred)_: Add Zonos, Gemini Flash TTS, etc. as the OpenRouter catalog grows. Cheap once the abstraction exists.

### Pre-implementation gates

Before Phase 1 implementation:

1. **Plan-mode pass** — deep design of `TtsProvider` interface shape, schema, and gotchas (e.g., does slot-eviction belong on the provider interface or stay provider-specific?)
2. **Council review** — abstraction shape is the kind of "multiple viable approaches" the project memory says to consult on

### Cost projection at current ElevenLabs spend (~$200/mo, ~1.8M chars/mo)

| Path                             | $/mo  | Reduction             |
| -------------------------------- | ----- | --------------------- |
| ElevenLabs (status quo)          | ~$200 | 0%                    |
| Voxtral (Phase 1)                | ~$30  | 85%                   |
| Zonos (Phase 3 if pursued)       | ~$13  | 94%                   |
| Self-hosted NeuTTS Air free tier | $0    | 100% (free tier only) |

## 2026-05-02 Mistral smoke test results

Empirical pre-PR-1 gates closed. This doc is the durable record — the findings were originally folded into a build-process plan doc (`tts-engine-upgrade-phase-1-plan.md`) that was deleted once Phase 1 shipped.

### Endpoint corrections from the 2026-05-01 plan

The original plan referenced `/v1/voices` endpoints; smoke test confirmed Mistral uses the `/v1/audio/` namespace:

| Operation        | Endpoint                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clone voice      | `POST /v1/audio/voices`         | JSON body with base64 reference audio. Mistral silently drops `slug`/`languages`/`gender`/`age`/`tags` on creation; only `name` survives.                                                                                                                                                                                                                                                             |
| Synthesize       | `POST /v1/audio/speech`         | Always returns `application/json` with base64 `audio_data` field — never raw binary, even with `response_format: 'wav'`. Client decodes at boundary.                                                                                                                                                                                                                                                  |
| List voices      | `GET /v1/audio/voices`          | Paginated via `?limit=50&offset=N` — the documented request params. `page`/`page_size`/`total_pages` exist ONLY in the response; sent as request params they are silently ignored and the same window returns every time (the original smoke test used `?page=1&page_size=50` and couldn't see this with a single-window account). Items have `user_id: null` for presets, populated UUID for cloned. |
| Delete voice     | `DELETE /v1/audio/voices/{id}`  | Returns 200 with deleted voice body.                                                                                                                                                                                                                                                                                                                                                                  |
| Transcribe (STT) | `POST /v1/audio/transcriptions` | Same key authorizes. Not used in PR 1 — STT cutover deferred.                                                                                                                                                                                                                                                                                                                                         |

**TTS model name**: `voxtral-mini-tts-latest` (or pinned `voxtral-mini-tts-2603`). Distinct from STT siblings `voxtral-mini-transcribe-2507` and `voxtral-mini-realtime-2602`.

### Latency observations (smoke test, 4 personas, real references)

| Operation  | Range       | Notes                                                                                        |
| ---------- | ----------- | -------------------------------------------------------------------------------------------- |
| Clone      | 332–852ms   | Reference duration weakly correlated; even 4s reference → ~330ms clone.                      |
| Synthesize | 2378–6502ms | Roughly ~14ms per character of input text. 200-char passage ≈ 2.4s; 354-char passage ≈ 3.7s. |
| Delete     | 182–427ms   | Fast and consistent.                                                                         |

### Input format tolerance

Mistral's `POST /v1/audio/voices` accepted MP3 stereo at 44.1/48kHz directly with no normalization required. Earlier WAV/22kHz/mono synthetic test also worked. Conclusion: **gateway can stay pass-through; no upload-time `normalizeAudio()` helper needed for Mistral.** If a future provider does require canonical input, that provider's `prepare()` does its own normalization.

### Output loudness experiment

A real concern surfaced during the user listening test: **Mistral's per-voice synthesis loudness varies by 13.8 LU across personas** (default; no normalization). The four personas measured at:

| Persona             | LUFS (raw) |
| ------------------- | ---------- |
| Charlie Morningstar | -32.3      |
| Emily               | -26.9      |
| Speaker of God      | -22.2      |
| Emberlynn           | -18.5      |

That spread is well above perceptual threshold — listeners reach for the volume knob. Two normalization strategies tested:

**Reference-side normalization (FAILED)**: applying EBU R128 loudnorm to references before clone narrowed output spread to 10.3 LU only (Emily got QUIETER, contra hypothesis) AND audibly distorted vocal character. Root cause: `loudnorm`'s LRA (loudness range) target applies dynamic range compression that crushes the expressive peaks the model conditions on for voice character. Cloned voices became flatter, less themselves. User confirmed subjective distortion.

**Output-side normalization (WORKS)**: applying same `loudnorm=I=-14:LRA=11:TP=-1.5` to synthesized output collapsed the spread to **1.7 LU** with no character distortion — the output is post-synthesis flat-ish speech with no expressive dynamics to crush.

**Decision**: output-side normalization in `TTSStep.process()`, target -14 LUFS (Spotify standard), provider-agnostic. -14 chosen over podcast-standard -16 because Discord has no native loudness normalization and AI voice has to compete with human-mic audio in mobile/noisy environments. Selected via supplementary council pass (Gemini 3.1 Pro Preview, 2026-05-02).

### Architectural decisions surfaced by smoke test

Beyond the gates themselves, three additional decisions came out of the supplementary council pass:

| Decision                           | Choice                                                    | Why                                                                                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth shape for Mistral key         | `audioProviderKeys: ReadonlyMap<AudioProviderId, string>` | Single Mistral key authorizes both `/v1/audio/speech` AND `/v1/audio/transcriptions` (same for ElevenLabs). Natural domain unit is "audio-provider credentials," not "TTS credentials." Generic map replaces the named `elevenlabsApiKey?: string` field. |
| STT cutover scope                  | Deferred until ElevenLabs renewal                         | Mistral STT quality on multilingual content (English + occasional Hebrew) is unmeasured. PR 1 plumbs auth in the new map shape but STT consumer (`AudioProcessor.transcribeAudio`) stays pinned to ElevenLabs. Cutover gated on a benchmark.              |
| Mistral `ref_audio` zero-shot mode | Skip                                                      | Stateful clone-and-cache wins on per-call latency vs ~1MB base64 reference per synthesize call. Matches existing ElevenLabs lifecycle pattern; no architectural duplication.                                                                              |

### Cache strategy correction

An earlier (now-superseded) architectural assumption suggested Mistral's silent-drop of metadata fields meant we needed a DB mapping table for `personality_slug → voice_id`. That was wrong: the existing `ElevenLabsVoiceService` doesn't use a DB table either — it uses the `name` field as the canonical identifier (`tzurot-{slug}`) plus an in-memory `TTLCache` for fast-path. Mistral preserves `name` faithfully, so the same pattern works directly. **No DB schema change for voice-id mapping.**

## References

- Backlog: BACKLOG.md → Future Themes → Voice Engine
- Pocket TTS GitHub: https://github.com/kyutai-labs/pocket-tts
- Parakeet TDT HuggingFace: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- NeuTTS Air GitHub: https://github.com/neuphonic/neutts
- Voxtral Mini TTS (OpenRouter): https://openrouter.ai/mistralai/voxtral-mini-tts-2603
- Zonos GitHub: https://github.com/Zyphra/Zonos
- OpenRouter TTS catalog API: https://openrouter.ai/api/v1/models?output_modalities=speech
- Mistral API audio endpoints: https://docs.mistral.ai/api/endpoint/audio/speech, https://docs.mistral.ai/api/endpoint/audio/voices
- EBU R128 loudness standard: https://tech.ebu.ch/loudness
