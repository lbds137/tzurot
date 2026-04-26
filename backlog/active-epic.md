## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost via self-hosted + BYOK alternatives. Promoted 2026-04-21 from "Current Focus → Other in-flight" after priority-validation discussion (cost bleed outprioritizes tech debt)._

**Status**: Research done 2026-04-12 identified Chatterbox (self-hosted) and Voxtral (BYOK) as top candidates. Gemini 3.1 Flash TTS (announced 2026-04-15, preview) added as third BYOK candidate. No candidate committed yet — hands-on eval is the gate.

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

1. Spin up Chatterbox Turbo in a test container (Railway dev or local) — `docker compose -f docker/docker-compose.cpu.yml up -d` from [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)
2. Feed it a character reference audio; compare output quality vs Pocket TTS and vs ElevenLabs
3. Hands-on Gemini + Voxtral eval with the same reference audio (pricing transparency first for Gemini before committing)
4. Pick the BYOK option based on quality + price + cloning fidelity; plan voice-engine integration (swap TTS backend, keep STT as-is)

**Start**: `services/voice-engine/server.py` (current Pocket TTS integration); research links saved in Claude auto-memory (`project_voice_tts_research.md`).
