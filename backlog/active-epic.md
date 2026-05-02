## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost — BOTH the TTS subscription AND the Scribe STT line — via self-hosted + Mistral BYOK alternatives. Promoted 2026-04-21 from "Current Focus → Other in-flight" after priority-validation discussion (cost bleed outprioritizes tech debt)._

**🚧 Release freeze in effect (2026-05-02)**: no new beta releases until Phases 1, 2, AND 3 all ship and the epic is complete. Develop accumulates work; main stays at v3.0.0-beta.113 until the full ElevenLabs cutover lands. Reasoning: shipping intermediate betas during a multi-phase migration risks either rolling back partial cutover state OR locking in a "TTS-on-Mistral / STT-on-ElevenLabs" hybrid that defeats the epic's value. Single-user project tolerates the develop-only window.

**Epic-complete bar** (all three required):

1. Phase 1 — Mistral TTS BYOK shipped (PR 1/2/3 of TTS Phase 1 plan)
2. Phase 2 — NeuTTS Air free-tier engine shipped
3. Phase 3 — Mistral STT cutover shipped (gated on quality benchmark passing)

**Status**: All Phase 1 decisions locked + pre-implementation gates closed 2026-05-02. **PR 1 cleared to start.** Empirical smoke test validated cloning quality (real-voice references for Emily/Emberlynn/Charlie/Speaker-of-God all succeeded; user confirmed quality comparable to ElevenLabs). Supplementary council pass settled output-normalization, auth-shape, and STT-scope questions surfaced during smoke testing.

**The goal**: ~85% cost reduction on the ElevenLabs line item via BYOK Voxtral, plus a self-hosted free tier with optional voice cloning via NeuTTS Air alongside the existing Kyutai/Pocket TTS.

**Full research + decision log**: [`docs/research/voice-cloning-2026.md`](../docs/research/voice-cloning-2026.md) — the "2026-05-01 TTS Upgrade Decision" section captures the OpenRouter catalog survey, CPU-only candidate ranking, Chatterbox-CPU non-viability finding, and the rationale for each decision.

### Settled decisions

**2026-05-01 three-council reconciled**:

- **BYOK provider** (Phase 1): **Voxtral via DIRECT Mistral API** ($16/1M chars). Beats ElevenLabs Flash v2.5 in 68.4% of blind tests; matches v3. 3-30s reference-audio range covers existing audio library. Discovered during council review: OpenRouter doesn't expose voices management API needed for cloning, only proxies `/audio/speech`. Cloning requires direct Mistral integration. Same pricing, same model, no markup. Zonos at $7/1M is a viable Phase 3 fallback if spend remains too high.
- **Free-tier engine** (Phase 2): **Keep Kyutai/Pocket TTS, ADD NeuTTS Air alongside** (additive design). Hands-on eval after Phase 2 ships will decide whether Kyutai gets deprecated.
- **Reference audio storage**: stays in api-gateway's `/voice-references/{slug}` endpoint, gateway is pass-through.
- **Architecture order**: abstraction-first. Build the `TtsProvider` interface + `tts_configs` cascade before plugging in providers.
- **Chatterbox**: dropped from active consideration. Documented as not CPU-viable on Railway. NeuTTS Air takes its place as the cloning-capable self-hosted candidate.

**2026-05-02 smoke-test + supplementary council**:

- **Endpoint paths**: `/v1/audio/voices`, `/v1/audio/speech`, `/v1/audio/transcriptions` (the `/v1/audio/` namespace, not `/v1/`). Model name `voxtral-mini-tts-latest`.
- **Response shape**: Mistral always returns JSON-wrapped base64 `audio_data` (never raw binary, even with `response_format: 'wav'`). Client decodes at the boundary.
- **Cache strategy**: identical pattern to existing ElevenLabs — name-as-find-key (`tzurot-${slug}`), in-memory `TTLCache`, no DB mapping table.
- **Gateway-side audio normalization**: SKIPPED. Mistral accepts MP3 stereo at 44.1/48kHz directly.
- **Output-side loudness normalization**: REQUIRED. EBU R128 loudnorm at **-14 LUFS** (Spotify standard), LRA=11, TP=-1.5. Applied in `TTSStep.process()` post-synthesis, pre-Redis-write. Provider-agnostic — works for ElevenLabs, Mistral, NeuTTS Air, future providers. Smoke test showed loudness spread collapses from 13.8 LU → 1.7 LU after normalization. Reference-side normalization explicitly REJECTED — distorts vocal character without solving the problem.
- **Auth shape**: `audioProviderKeys: ReadonlyMap<AudioProviderId, string>` on `ResolvedAuth` covering BOTH TTS and STT. One Mistral key authorizes all `/v1/audio/*` endpoints; same for ElevenLabs. Generic map replaces the named `elevenlabsApiKey?: string` field.
- **STT cutover**: in-epic as Phase 3 (revised 2026-05-02 from "deferred until renewal" — see release-freeze rationale at top). Gated on a quality benchmark (Mistral Voxtral Transcribe vs ElevenLabs Scribe) on real user content (English + occasional Hebrew). PR 1 of Phase 1 plumbs auth for both providers via the `audioProviderKeys` map; the consumer flip happens in Phase 3.
- **`ref_audio` zero-shot mode**: SKIPPED. Stateful clone-and-cache (current plan) wins on per-call latency and matches the existing ElevenLabs lifecycle pattern.

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

**Phase 1** _(cleared to start — split across PR 1 + PR 2 + PR 3 per the plan doc)_:

PR 1 (Foundation, no behavior change):

1. New `tts_configs` table mirroring `llm_configs` cascade + hard-cutover migration of existing `configOverrides.elevenlabsTtsModel`
2. New `TtsConfigResolver` parallel to `LlmConfigResolver`
3. Extract `TtsProvider` interface; refactor existing two services into providers (slot-eviction logic intact for ElevenLabs)
4. Auth shape change: `ResolvedAuth.elevenlabsApiKey` → `audioProviderKeys: Map<AudioProviderId, string>` covering ~6 consumer files
5. Output-side loudness normalizer (`audioNormalizer.ts`) called from `TTSStep.process()`

PR 2 (Mistral provider + dispatch): 6. `MistralTtsClient.ts` (decodes JSON-wrapped base64 at boundary) + `MistralTtsProvider.ts` (clone-and-cache, name-as-find-key, eviction mutex) 7. `TtsDispatcher.ts` walks fallback chain respecting `isFallbackEligible` 8. TTSStep refactor: replace hardcoded branching with resolver + dispatcher

PR 3 (Settings UX): 9. `/settings tts ...` subcommand group + gateway routes for user/admin TTS config management

**Full plan**: [`docs/proposals/backlog/tts-engine-upgrade-phase-1-plan.md`](../docs/proposals/backlog/tts-engine-upgrade-phase-1-plan.md).

**Phase 2** _(separate PR after Phase 1)_: NeuTTS Air as second self-hosted engine in `services/voice-engine/server.py`. TTS preset gains `selfHostedEngine: 'kyutai' | 'neutts-air'`. Hands-on eval gates the Kyutai-deprecation question.

**Phase 3** _(STT cutover — gated on benchmark)_: flip `AudioProcessor.transcribeAudio` from ElevenLabs Scribe to Mistral Voxtral Transcribe. Auth plumbing already exists post-Phase-1 via the `audioProviderKeys` map, so this is a one-line consumer swap once the benchmark gate clears.

- **Benchmark gate**: capture ~20 representative real voice messages spanning the bot's language mix (English + occasional Hebrew/multilingual). Transcribe each via both providers. Score WER + qualitative accuracy on multilingual edge cases. Pass criterion: Mistral matches OR exceeds ElevenLabs Scribe on the sample. If Mistral underperforms on multilingual, escalate the decision (alternatives: keep ElevenLabs STT but downgrade plan; investigate Mistral STT model variants like `voxtral-mini-realtime` for live transcription).
- **Why gated, not blocking**: TTS is the larger cost line and the higher-confidence migration. Phase 1 ships the bulk of the value; Phase 3 closes the loop.
- **What ships in Phase 3**: AudioProcessor consumer flip + benchmark documentation + telemetry log line for STT calls (parallel to TTS cost telemetry from Phase 1) + ElevenLabs subscription cancellation note.

**Out of epic** _(future, not gating completion)_: additional TTS providers (Zonos, Gemini Flash TTS, OpenRouter preset-voice tier) as OpenRouter expands. Cheap to plug in once abstraction exists. Track separately in inbox/icebox.

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

**Next session — start PR 1 implementation.** Plan + smoke test + council are all closed. Open the plan doc → execute the PR 1 task list. First concrete step: Prisma migration for `tts_configs` + the auth-shape change to `audioProviderKeys` (those two compile-break the rest of the codebase, so doing them first surfaces all the consumer-update sites cleanly).
