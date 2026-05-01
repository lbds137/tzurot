## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost via self-hosted + BYOK alternatives. Promoted 2026-04-21 from "Current Focus → Other in-flight" after priority-validation discussion (cost bleed outprioritizes tech debt)._

**Status**: Research done 2026-04-12 identified Chatterbox (self-hosted) and Voxtral (BYOK) as top candidates. Gemini 3.1 Flash TTS (announced 2026-04-15, preview) added as third BYOK candidate. **Quality question settled 2026-05-01** — user has heard Chatterbox samples and confirmed they sound better than Pocket TTS and comparable-or-better to ElevenLabs; no A/B test needed. **Open gate is now performance characterization**: CPU vs GPU latency under Railway's CPU-only constraint, plus a survey of OpenRouter's recently-announced voice-synthesis models (must support voice cloning to qualify).

**The goal**: ~90% cost reduction (self-hosted) or ~75% (BYOK Voxtral/Fish) on the TTS line item.

**Additive design** (per user preference — see Claude auto-memory `project_tts_additive_design.md`): new engines selectable alongside existing Pocket TTS; nothing replaced wholesale. Users pick their local TTS engine.

### Candidates

**Self-hosted (replace Pocket TTS):**

- **Chatterbox Turbo** (350M, Resemble AI, MIT) — beats ElevenLabs in 63.75% of blind tests; native zero-shot voice cloning + emotion control; explicit CPU Docker support; OpenAI-compatible API servers exist. **Primary candidate.**
- **Kokoro 82M** (Apache) — #1 TTS Arena, tiny and CPU-optimized. No native voice cloning (needs third-party KokoClone addon). Backup if Chatterbox is too heavy for Railway 4GB.

**BYOK (replace ElevenLabs as premium tier):**

- **Gemini 3.1 Flash TTS** (Google, 2026-04-15) — 70+ languages, **#2 on Artificial Analysis Speech Arena Leaderboard** (ahead of ElevenLabs Eleven v3, only behind Inworld TTS 1.5 Max — confirmed 2026-04-15 via @ArtificialAnlys), Elo 1,211, "Audio Profiles" via natural-language Director's Notes, SynthID watermarking. **Open questions**: pricing not disclosed (preview), whether "Audio Profiles" includes true zero-shot cloning or preset-voice selection only, latency, API stability.
- **Voxtral** (Mistral, $16/1M chars) — 73% cheaper than ElevenLabs, wins 68% vs EL Flash in human prefs, zero-shot cloning from 3s audio confirmed. Open-weight available as self-host fallback.
- **Fish Audio** ($15/1M chars) — #1 TTS-Arena, 75% cheaper than ElevenLabs.

### Ancillary work folded in

- **Proactive voice-engine warmup parallel to ElevenLabs TTS** — Kick off voice-engine `/health` warmup (fire-and-forget) at start of every ElevenLabs attempt so the fallback path has a warm engine waiting. Currently fallback incurs ~47s cold start. Low urgency — beta.97 widened the outer budget to 240s. **Start**: `services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `performElevenLabsTTSWithFallback`; consider a shared `VoiceEngineWarmup` helper callable from both ElevenLabs and voice-engine-direct paths.
- **Reduce ElevenLabs per-attempt timeout from 60s to 30-45s** — Beta.97 cut ElevenLabs retries 2→1, but per-attempt timeout is still 60s (hardcoded in `elevenLabsFetch` via `AbortController`). When ElevenLabs genuinely can't respond, detecting failure 15-30s earlier gives voice-engine fallback more headroom. Requires measurement: what's the p99 ElevenLabs successful-call duration? If <30s, the 60s budget is 2x overkill. **Start**: `services/ai-worker/src/services/voice/ElevenLabsClient.ts` `elevenLabsFetch`; pair with the retry telemetry added to `withRetry` in beta.97.
- **Audit ElevenLabs STT + voice-engine retry counts for same bug pattern** — Beta.97 reduced `ELEVENLABS_MAX_ATTEMPTS` (TTS) 2→1. Parallel code paths likely have the same latent bug: `ELEVENLABS_STT_RETRY.MAX_ATTEMPTS` in `services/ai-worker/src/services/multimodal/AudioProcessor.ts:28`, and voice-engine retry in `services/ai-worker/src/services/voice/VoiceEngineClient.ts:219` (comment says "matches ElevenLabs retry budget"). Likely need the same 2→1 cut. Not bundled into beta.97 to keep scope tight; folding into this epic once telemetry shows retry success rates for STT and voice-engine paths. **Adjacent**: when any `MAX_ATTEMPTS` is raised again, add direct unit tests for the relevant `isTransient*Error` classifier before the bump — at `maxAttempts=1` the classifier is dormant (never invoked by `withRetry`), so a silent classification regression wouldn't fail any current test (`services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` `isTransientElevenLabsError` flagged in PR #805 review).

### Next steps

1. **OpenRouter voice-synthesis survey** — list models on OpenRouter that offer TTS; filter for those supporting voice cloning (zero-shot or reference-audio); compare per-character pricing against ElevenLabs ($110/1M chars) and Voxtral ($16/1M chars). If a strong candidate emerges, the BYOK path becomes "wire OpenRouter TTS into the voice-engine fallback chain" — single integration point that already plumbs auth, retries, and error classification.
2. **Chatterbox Turbo CPU vs GPU perf characterization** — spin up [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server) (`docker compose -f docker/docker-compose.cpu.yml up -d` for CPU; equivalent GPU compose for comparison). Measure: cold-start time, per-second-of-audio synthesis latency on CPU vs GPU, peak RSS under Railway's 4GB constraint. The decision criterion is whether CPU-only is fast enough for the live-message TTS budget; if not, the self-hosted path requires GPU hosting outside Railway and the cost calculus shifts.
3. **Voice-engine integration plan** — once one candidate (OpenRouter BYOK or self-hosted Chatterbox) clears its perf gate, design the swap-in: extend `services/voice-engine/server.py`'s TTS backend abstraction to add the new engine alongside Pocket TTS (additive design — see Claude auto-memory `project_tts_additive_design.md`), expose engine selection via existing settings cascade, keep STT as-is.

**Start**: `services/voice-engine/server.py` (current Pocket TTS integration); `services/ai-worker/src/services/voice/ElevenLabsClient.ts` for the existing TTS surface area; research links in Claude auto-memory (`project_voice_tts_research.md`); OpenRouter model catalog at [openrouter.ai/models](https://openrouter.ai/models).
