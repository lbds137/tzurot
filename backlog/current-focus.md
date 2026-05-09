## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **TTS Engine Upgrade Phase 3 PR 1** (`/voice` namespace consolidation) — pure-refactor PR per the locked 2026-05-05 council passes: move `/settings tts` and `/settings voices` under a unified `/voice` namespace with deprecation stubs on the old paths. No behavior change. See [`active-epic.md`](active-epic.md) Phase 3 section and [`tts-phase-3-voice-consolidation-plan.md`](../docs/proposals/backlog/tts-phase-3-voice-consolidation-plan.md). Sets up Phase 3 PR 2 (Mistral STT cutover, the actual material payoff of yesterday's BYOK decision).

### Most likely next-session pickups

1. **TTS Engine Upgrade Phase 3 PR 2** (Mistral STT cutover + provider-set + 4-layer resolver wiring) — the material payoff of the consolidation. Lights up Mistral as the BYOK STT path in production.
2. **TTS Engine Upgrade Phase 2** (NeuTTS Air) — second self-hosted engine, voice-cloning capable, completes the additive provider matrix. Independent of Phase 3 ordering.

_UX polish on the new `/voice` surface is folded into PR 1/PR 2 instead of being a standalone item — doing it on `/settings tts` right before the rename would be throwaway work._

### Other in-flight

_None._
