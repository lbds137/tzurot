## 🏗 Active Epic: TTS Engine Upgrade

_Focus: Eliminate the ~$200/month ElevenLabs recurring cost — BOTH the TTS subscription AND the Scribe STT line — via self-hosted + Mistral BYOK alternatives._

**Phase 1 (Mistral Voxtral BYOK) shipped** in v3.0.0-beta.115 (2026-05-04) with post-deploy hardening + UX polish landing in v3.0.0-beta.116 (2026-05-05). **Phase 3 (Mistral STT cutover + `/voice` consolidation) shipped** across PR #1003 + #1005, awaiting the v3.0.0-beta.120 release to reach prod. Phase 2 (NeuTTS Air) remains. Release freeze LIFTED.

**Epic-complete bar** (all three required):

1. ✅ Phase 1 — Mistral TTS BYOK shipped (beta.115)
2. ⬜ Phase 2 — NeuTTS Air free-tier engine shipped
3. ✅ Phase 3 — Mistral STT cutover shipped (PR #1003 + #1005, merged 2026-05-09 → 2026-05-10; awaiting beta.120 release)

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

### Phase 3: `/voice` consolidation + Mistral STT cutover — DONE

**Status**: SHIPPED across two PRs, awaiting beta.120 release to reach prod.

- **PR #1003** (merged 2026-05-09) — `/voice` namespace consolidation. Pure refactor moving `/settings tts` + `/settings voices` under unified `/voice`. Deprecation stubs preserved for ~1 month.
- **PR #1004** (merged 2026-05-09) — `/settings preset` symmetric naming quick-win. Foreshadowed Phase 3 PR 2's command shape.
- **PR #1005** (merged 2026-05-10) — Mistral STT cutover + 5-layer cascade resolver + `/voice provider/stt/view` + JIT teaching footer on `/voice tts set`. Migration applied to dev + prod. ~5,500 LoC, 7 review rounds, all blocking findings resolved or properly backlogged.

The cascade ended up at **5 layers** (not the originally-planned 4) because `/voice stt` adopted the symmetric `set/clear/set-default/clear-default` shape during PR 2 plan-mode, adding a user-default STT layer (Layer 2) on top of the original 4-layer design.

5 substantive follow-ups filed in `backlog/inbox.md` from PR #1005 review (cache-invalidation wiring, in-band attachment STT path, shared cascade helper, DB CHECK constraints, JIT footer timeout). All have concrete fix shapes + promote-when criteria.

**Original plan-mode content (kept for reference)**:

**Scope expansion**: Phase 3 grew during 2026-05-05 design discussion. Original framing was "flip STT consumer + add `/settings stt` parallel command surface." Council pass 1 validated parallel surface with Option B shape (minimal `view/set/clear`); user pushed back during follow-up that consolidating to a top-level `/voice` namespace is cleaner — citing existing `/preset` precedent for top-level domain commands. Grepping `services/bot-client/src/commands/settings/` surfaced that **`/settings` has TWO voice-related subgroups today** (`tts` for provider config + `voices` for cloned-voice management), making the consolidation opportunity bigger than initial framing.

Council pass 2 validated the consolidation shape, **reversed** the slicing recommendation to "refactor first, feature second" for blast-radius isolation, and **corrected the bundled-default semantic** to single-field-write rather than dual-field-write (preserves 4-layer chain integrity).

**Two-PR shape**:

- **PR 1 — Pure refactor**: migrate `/settings tts/*` and `/settings voices/*` handlers into a new top-level `/voice` namespace. Add `/voice view` dashboard. Replace old commands with ephemeral deprecation stubs. **Zero new behavior** — STT still ElevenLabs, no Layer 1 override exists yet.
- **PR 2 — Phase 3 cutover + provider-set**: add `/voice provider set/clear` (writes single `default_provider` field, Layer 3), `/voice stt set/clear` (Layer 1 escape valve), wire the 4-layer resolver into `AudioProcessor.transcribeAudio`, flip STT path to Mistral Voxtral Transcribe.

**Final command shape** (after both PRs):

```
/voice view                  — dashboard: resolved TTS + STT + cloned voices
/voice browse                — paginated cloned-voice list
/voice clear <slug>          — clear reference audio
/voice delete <slug>         — delete cloned voice slot
/voice provider set <id>     — bundled default (Layer 3)
/voice provider clear
/voice tts set <id>          — TTS-specific override
/voice tts clear
/voice stt set <id>          — STT-specific override (Layer 1 escape valve)
/voice stt clear
```

**4-layer STT resolution chain** (locked):

1. User explicit STT override (`/voice stt set <id>`)
2. Derive from TTS provider (if user has Mistral TTS, use Mistral STT)
3. Admin/system `default_provider` (from `/voice provider set`)
4. voice-engine fallback (free tier)

**Benchmark gate dropped**: original plan called for a multilingual WER benchmark (~20 real voice messages) before Phase 3 cutover. User decided against benchmark-as-gate during 2026-05-05 discussion — bundling TTS+STT by provider is the user-preferred UX regardless of marginal STT-quality differences, and the Layer 1 escape valve preserves the option to opt out per-user if quality matters more than cost for a specific case.

**Discord-specific deploy gotchas** (handled in PR 1):

- Client-side command cache: post-deploy, users may need Ctrl/Cmd+R to refresh — single-line announcement message planned.
- Global vs guild command propagation: confirm registration mode during plan-mode (guild = instant, global = up to 1hr).
- Deprecation stubs not deletion: old `/settings tts` and `/settings voices` reply ephemerally pointing at `/voice` for ~1 month before removal (backlog item filed).

**Full plan**: [`docs/proposals/backlog/tts-phase-3-voice-consolidation-plan.md`](../docs/proposals/backlog/tts-phase-3-voice-consolidation-plan.md). Read this before starting plan-mode tomorrow.

---

### Out of epic (future, not gating completion)

- Additional TTS providers (Zonos, Gemini Flash TTS, OpenRouter preset-voice tier) as OpenRouter expands. Cheap to plug in once the abstraction exists. Track separately in inbox/icebox.
- Cost projection table from the original plan still stands: Voxtral ~$30/mo (85% reduction), Zonos ~$13/mo (94% reduction), free-tier $0 (100%).

### Next-session entry points

- **Phase 3 plan-mode pass**: open `docs/research/voice-cloning-2026.md` + run the Mistral STT benchmark scaffolding. Phase 3 is the higher-value next step.
- **Or Phase 2 plan-mode pass**: open `services/voice-engine/server.py` + survey what NeuTTS Air's HTTP shape would look like. Lower urgency.
- **Or pivot to `/settings tts` UX polish**: smaller, user-visible work on what Phase 1 already shipped. Useful if Phase 2/3 plan-modes feel large.
