## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost via self-hosted + BYOK alternatives. Promoted 2026-04-21 from "Current Focus → Other in-flight" after priority-validation discussion (cost bleed outprioritizes tech debt)._

**Status**: Decisions locked 2026-05-01. Pre-implementation gates remaining: plan-mode + council review on the architecture, then Phase 1 implementation.

**The goal**: ~85% cost reduction on the ElevenLabs line item via BYOK Voxtral, plus a self-hosted free tier with optional voice cloning via NeuTTS Air alongside the existing Kyutai/Pocket TTS.

**Full research + decision log**: [`docs/research/voice-cloning-2026.md`](../docs/research/voice-cloning-2026.md) — the "2026-05-01 TTS Upgrade Decision" section captures the OpenRouter catalog survey, CPU-only candidate ranking, Chatterbox-CPU non-viability finding, and the rationale for each decision.

### Settled decisions (2026-05-01, three-council reconciled)

- **BYOK provider** (Phase 1): **Voxtral via DIRECT Mistral API** ($16/1M chars). Beats ElevenLabs Flash v2.5 in 68.4% of blind tests; matches v3. 3-30s reference-audio range covers existing audio library. Discovered during council review: OpenRouter doesn't expose voices management API needed for cloning, only proxies `/audio/speech`. Cloning requires direct Mistral integration. Same pricing, same model, no markup. Zonos at $7/1M is a viable Phase 3 fallback if spend remains too high.
- **Free-tier engine** (Phase 2): **Keep Kyutai/Pocket TTS, ADD NeuTTS Air alongside** (additive design). Hands-on eval after Phase 2 ships will decide whether Kyutai gets deprecated.
- **Reference audio storage**: stays in api-gateway's `/voice-references/{slug}` endpoint. PR 1 verifies it returns canonical format (PCM WAV 16-bit 24kHz mono) or adds `normalizeAudio()` helper.
- **Architecture order**: abstraction-first. Build the `TtsProvider` interface + `tts_configs` cascade before plugging in providers.
- **Chatterbox**: dropped from active consideration. Documented as not CPU-viable on Railway. NeuTTS Air takes its place as the cloning-capable self-hosted candidate.

### Three-council reconciled design (2026-05-01)

Plan reviewed by Gemini 3.1 Pro Preview → GLM 5.1 → Kimi K2.6. Convergent decisions:

- **No `Symbol.asyncDispose`** (2-1 vote: GLM + Kimi against Gemini). No current provider needs cleanup. Optional `dispose?()` non-breaking to add later.
- **No `referenceAudioVersion` schema column** (2-1 vote). Hash lives in provider-internal `Map<slug, hash>` + ElevenLabs/Mistral voice description field for restart resilience.
- **Keep PR 1+2 separate** (2-1 vote). Existing 2 service refactors validate the interface in PR 1; combined PR hurts claude-bot review of large diffs.
- **Buffer return type, not streaming union** (2-1 vote). Add separate `synthesizeStream()` method later if needed.
- **Hard cutover migration, kill dual-write shim** (3-0). Single user, Prisma migration is 30 min.
- **Reuse existing `ApiErrorCategory`** (3-0). Add `VOICE_NOT_FOUND` + `CLONING_FAILED`. Add `provider` field on errors.
- **Eviction mutex on stateful providers** (3-0). 5 lines, prevents non-deterministic capacity-exceeded race.
- **Curl Mistral API first** (3-0). Pre-PR-2 gate.

Kimi's net-new findings (both prior councils missed):

- **`capabilities` object** on `TtsProvider` (`maxCharacters`, `requiresPrepare`, `supportsReferenceAudio`, `outputFormat`).
- **`isFallbackEligible: boolean`** on errors (not all errors should retry on fallback provider — 400 burns credits).
- **`PreparedTts` as opaque discriminated union** unifying stateful voiceId + stateless inlineAudio under one interface.
- **Resolver-level `PreparedTts` cache** (single-instance Map, no Redis needed; avoids re-clone per Discord message).
- **`isAvailable()` predicate** for clean provider gating without auth-error-catch.

Plus: cost telemetry log line per synthesis call, audio format normalization at gateway boundary, isolated `buildVoxtralSpeechBody()` for OpenRouter/Mistral API volatility.

### Architecture starting point

Most of the abstraction already exists in shape. `services/ai-worker/src/services/voice/` has:

- `VoiceRegistrationService` — lazy-register lifecycle for self-hosted voice-engine
- `ElevenLabsVoiceService` — lazy-clone lifecycle with slot-eviction ("musical chairs") for BYOK
- Both consume `fetchVoiceReference(slug)` → api-gateway

The Phase 1 work is **extract `TtsProvider` interface + add config-driven routing + add Voxtral as a third provider** following the existing pattern. Not "build from scratch."

### Phased plan

**Phase 1** _(next session — single PR, 1-2 evenings of focused work)_:

1. **Plan-mode pass** to design `TtsProvider` interface shape, schema, and gotchas
2. **Council review** of the design (abstraction shape is the canonical "multiple viable approaches" case)
3. New `tts_configs` table mirroring `llm_configs` cascade
4. New `TtsConfigResolver` parallel to `LlmConfigResolver`
5. Extract `TtsProvider` interface from the two existing services
6. Refactor existing services into providers (slot-eviction logic intact for ElevenLabs)
7. Add `OpenRouterTtsProvider` (Voxtral via `/audio/speech`); no slot management needed
8. TTSStep dispatches via resolver instead of hardcoded BYOK-vs-self-hosted check
9. Settings UX: `/settings tts ...` parallel to `/settings preset ...`

**Phase 2** _(separate PR after Phase 1)_: NeuTTS Air as second self-hosted engine in `services/voice-engine/server.py`. TTS preset gains `selfHostedEngine: 'kyutai' | 'neutts-air'`. Hands-on eval gates the Kyutai-deprecation question.

**Phase 3** _(deferred)_: Zonos, Gemini Flash TTS, others as OpenRouter expands. Cheap to plug in once abstraction exists.

### Ancillary work folded in

- **Proactive voice-engine warmup parallel to ElevenLabs TTS** — Kick off voice-engine `/health` warmup (fire-and-forget) at start of every ElevenLabs attempt so the fallback path has a warm engine waiting. Currently fallback incurs ~47s cold start. Low urgency — beta.97 widened the outer budget to 240s. **Start**: `services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `performElevenLabsTTSWithFallback`; consider a shared `VoiceEngineWarmup` helper callable from both ElevenLabs and voice-engine-direct paths.
- **Reduce ElevenLabs per-attempt timeout from 60s to 30-45s** — Beta.97 cut ElevenLabs retries 2→1, but per-attempt timeout is still 60s (hardcoded in `elevenLabsFetch` via `AbortController`). When ElevenLabs genuinely can't respond, detecting failure 15-30s earlier gives voice-engine fallback more headroom. Requires measurement: what's the p99 ElevenLabs successful-call duration? If <30s, the 60s budget is 2x overkill. **Start**: `services/ai-worker/src/services/voice/ElevenLabsClient.ts` `elevenLabsFetch`; pair with the retry telemetry added to `withRetry` in beta.97.
- **Audit ElevenLabs STT + voice-engine retry counts for same bug pattern** — Beta.97 reduced `ELEVENLABS_MAX_ATTEMPTS` (TTS) 2→1. Parallel code paths likely have the same latent bug: `ELEVENLABS_STT_RETRY.MAX_ATTEMPTS` in `services/ai-worker/src/services/multimodal/AudioProcessor.ts:28`, and voice-engine retry in `services/ai-worker/src/services/voice/VoiceEngineClient.ts:219` (comment says "matches ElevenLabs retry budget"). Likely need the same 2→1 cut. Not bundled into beta.97 to keep scope tight; folding into this epic once telemetry shows retry success rates for STT and voice-engine paths. **Adjacent**: when any `MAX_ATTEMPTS` is raised again, add direct unit tests for the relevant `isTransient*Error` classifier before the bump — at `maxAttempts=1` the classifier is dormant (never invoked by `withRetry`), so a silent classification regression wouldn't fail any current test (`services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `isTransientElevenLabsError` flagged in PR #805 review).

### Cost projection at current ElevenLabs spend (~$200/mo, ~1.8M chars/mo)

| Path                     | $/mo  | Reduction             |
| ------------------------ | ----- | --------------------- |
| ElevenLabs (status quo)  | ~$200 | 0%                    |
| Voxtral (Phase 1)        | ~$30  | 85%                   |
| Zonos (Phase 3 fallback) | ~$13  | 94%                   |
| Free-tier NeuTTS Air     | $0    | 100% (free tier only) |

**Start tomorrow**: plan-mode pass on the Phase 1 design — read `services/ai-worker/src/services/voice/` end-to-end, propose the `TtsProvider` interface, design the `tts_configs` schema, identify schema-migration considerations. Then council review. Then implementation.
