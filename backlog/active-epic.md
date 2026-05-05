## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost — BOTH the TTS subscription AND the Scribe STT line — via self-hosted + Mistral BYOK alternatives._

**Phase 1 (Mistral Voxtral BYOK) shipped** in v3.0.0-beta.115 (2026-05-04) with post-deploy hardening + UX polish landing in v3.0.0-beta.116 (2026-05-05). Phase 2 (NeuTTS Air) and Phase 3 (Mistral STT cutover) remain. Release freeze LIFTED — develop accumulates Phase 2/3 work; the next release ships when one of those phases is ready.

**Epic-complete bar** (all three required):

1. ✅ Phase 1 — Mistral TTS BYOK shipped
2. ⬜ Phase 2 — NeuTTS Air free-tier engine shipped
3. ⬜ Phase 3 — Mistral STT cutover shipped (gated on quality benchmark passing)

**The goal**: ~85% cost reduction on the ElevenLabs line item via BYOK Voxtral, plus a self-hosted free tier with optional voice cloning via NeuTTS Air alongside the existing Kyutai/Pocket TTS.

**Full research + decision log**: [`docs/research/voice-cloning-2026.md`](../docs/research/voice-cloning-2026.md) — the "2026-05-01 TTS Upgrade Decision" section captures the OpenRouter catalog survey, CPU-only candidate ranking, Chatterbox-CPU non-viability finding, and the rationale for each decision.

---

### Phase 1: Mistral Voxtral BYOK — DONE

PRs across beta.115 + beta.116 (chronological, abridged):

- **Pre-Phase-1 plumbing** (beta.114 era → beta.115): TTS provider abstraction (`TtsProvider` interface + `TtsConfigResolver`), `tts_configs` cascade migration, audio normalization (-14 LUFS), Mistral Voxtral BYOK provider with cost-telemetry-driven fallback chain, `/settings tts ...` subcommand group + admin/user CRUD routes, db-sync wiring for `tts_configs` (DEFERRABLE FK migrations), P2002 collision fix.
- **Post-deploy hardening** (beta.116): #974 (TTS fallback semantics + Mistral 30s pre-flight), #975 (Mistral hygiene + neg-cache transient/deterministic split), #976 (Mistral list-failure: refuse-to-clone instead of duplicate), #977 (`dispose()` lifecycle + `TtsConfigResolver` ERROR severity), #978 (config-service `checkDeleteConstraints` warning channel), #979 (`pr-merge-review-check` hook — meta), #980 (TTS Ouroboros sync int test), #981 (attachment aggregate cap raise to 100 MiB).

Settled-decisions snapshot from the original Phase 1 plan is captured in `docs/proposals/backlog/tts-engine-upgrade-phase-1-plan.md` for archival reference.

---

### Phase 2: NeuTTS Air free-tier engine

**Status**: Plan-mode pending. Cleared to start whenever ready.

**Scope**: NeuTTS Air as a second self-hosted engine in `services/voice-engine/server.py`, alongside the existing Kyutai/Pocket TTS. TTS preset gains `selfHostedEngine: 'kyutai' | 'neutts-air'`. Hands-on eval after this ships will gate the question of whether Kyutai gets deprecated or stays.

**Why second**: NeuTTS Air supports voice cloning (Kyutai doesn't) — useful as the free-tier cloning path for users who don't want to BYOK Mistral. Lower priority than Phase 3 (STT) because the cost win on TTS-side is already captured by Phase 1; NeuTTS Air is the "polish" that completes the additive provider matrix.

---

### Phase 3: Mistral STT cutover

**Status**: Plan-mode pending. **Likely the next-session candidate** — closes the cost loop on the second ElevenLabs line item.

**Scope**: Flip `AudioProcessor.transcribeAudio` from ElevenLabs Scribe to Mistral Voxtral Transcribe. Auth plumbing already exists post-Phase-1 via the `audioProviderKeys` map, so this is a one-line consumer swap **once the benchmark gate clears**.

**Benchmark gate** (required pre-cutover):

- Capture ~20 representative real voice messages spanning the bot's language mix (English + occasional Hebrew/multilingual)
- Transcribe each via both providers
- Score WER + qualitative accuracy on multilingual edge cases
- Pass criterion: Mistral matches OR exceeds ElevenLabs Scribe on the sample
- Fail criterion: Mistral underperforms on multilingual → escalate (alternatives: keep ElevenLabs STT but downgrade plan; investigate Mistral STT model variants like `voxtral-mini-realtime` for live transcription)

**4-layer fallback chain (planned for the consumer-side implementation)**:

1. User explicit override (`/settings stt provider <id>`)
2. Derive from TTS provider (if user has Mistral TTS configured, use Mistral STT too — minimizes setup friction)
3. Admin-configured system STT default
4. voice-engine fallback (free tier)

Council surfaced 3 design issues with deriving STT from TTS-default during planning (NeuTTS Air is TTS-only so can't derive, discoverability cost, bot-owner cost decoupling) — the 4-layer chain reconciles those.

**What ships in Phase 3**: AudioProcessor consumer flip + benchmark documentation + telemetry log line for STT calls (parallel to TTS cost telemetry from Phase 1) + ElevenLabs subscription cancellation note.

---

### Out of epic (future, not gating completion)

- Additional TTS providers (Zonos, Gemini Flash TTS, OpenRouter preset-voice tier) as OpenRouter expands. Cheap to plug in once the abstraction exists. Track separately in inbox/icebox.
- Cost projection table from the original plan still stands: Voxtral ~$30/mo (85% reduction), Zonos ~$13/mo (94% reduction), free-tier $0 (100%).

### Next-session entry points

- **Phase 3 plan-mode pass**: open `docs/research/voice-cloning-2026.md` + run the Mistral STT benchmark scaffolding. Phase 3 is the higher-value next step.
- **Or Phase 2 plan-mode pass**: open `services/voice-engine/server.py` + survey what NeuTTS Air's HTTP shape would look like. Lower urgency.
- **Or pivot to `/settings tts` UX polish**: smaller, user-visible work on what Phase 1 already shipped. Useful if Phase 2/3 plan-modes feel large.
