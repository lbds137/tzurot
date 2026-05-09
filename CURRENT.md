# Current

> **Session**: 2026-05-08 (late) — Shipped v3.0.0-beta.119 hotfix: voice transcription hang fix via fire-and-forget sendTyping helper + ESLint guard (#1000), voice-engine NeMo concurrency lock (#1001), fast-uri security patch (#998). Two voice-pipeline bugs fixed end-to-end (sendTyping REST queue stall surfaced by Discord typing-indicator outage; concurrent `.transcribe()` race in Parakeet TDT). Backlog gained two investigation entries (`@discordjs/rest` queue-stall, deploy-window retry-helper).
> **Version**: v3.0.0-beta.119 (released 2026-05-08; develop is currently SHA-aligned with main)
> **🚧 Release freeze status**: LIFTED. TTS Phase 3 PR 1 plan-mode pass is the next pickup.

---

## Next Session Goal

**TTS Engine Upgrade Phase 3 PR 1** — `/voice` namespace consolidation refactor. Plan-mode locked from the 2026-05-05 council passes; resume in plan-mode this session, then implement.

**Sequencing (decided 2026-05-09)**: PR 1 is a pure structural move with deprecation stubs — no behavior change. Standalone `/settings tts` UX polish was dropped from the queue because doing it on a surface about to be relocated would be throwaway work; UX wins fold into PR 1 / PR 2 directly in the new namespace. Order: **PR 1 (consolidation) → PR 2 (Mistral STT cutover, the material payoff of yesterday's BYOK decision) → Phase 2 (NeuTTS Air, independent)**.

**Read first**: [`docs/proposals/backlog/tts-phase-3-voice-consolidation-plan.md`](docs/proposals/backlog/tts-phase-3-voice-consolidation-plan.md) — locked plan from 2026-05-05 council passes. Also [`backlog/active-epic.md`](backlog/active-epic.md) Phase 3 section.

**Plan-mode entry points** (verify before code):

- Read `services/bot-client/src/commands/settings/tts/` and `services/bot-client/src/commands/settings/voices/` end-to-end — these are the two subgroups being unified into `/voice`.
- Confirm the deprecation-stub shape: redirect `/settings tts ...` and `/settings voices ...` to the new `/voice ...` paths with a one-time user-visible notice ("This command moved to /voice ...").
- Scope test rewrite: any `commands/settings/tts/*.test.ts` and `commands/settings/voices/*.test.ts` files migrate to `commands/voice/*.test.ts`. `CommandHandler.int.test.ts` snapshots will break — expected, regenerate them as part of the PR.
- Inbox item already filed: stub-removal scheduling ~1 month after PR 1 lands.

**Last session (2026-05-08, full day)**: shipped v3.0.0-beta.118 (`/character chat` push delivery + DM support PR #994, fast-follow tests #995, dependabot patches #996), then v3.0.0-beta.119 hotfix the same evening (voice transcription hang fix #1000, voice-engine NeMo concurrency lock #1001, fast-uri patch #998). Two voice-pipeline production bugs fully resolved end-to-end. User canceled ElevenLabs subscription and locked in Mistral as the BYOK path going forward — Phase 3 PR 2 is the material follow-through on that decision. Backlog gained two follow-up entries (`@discordjs/rest@2.6.1` upstream queue-stall investigation; deploy-window `UND_ERR_SOCKET` retry helper); decision recorded on the Mistral 30s reference-audio overflow inbox entry (option (b) — surface user-facing notice).

---

## Unreleased on Develop

_(empty — develop is currently SHA-aligned with main at v3.0.0-beta.119)_

---

## Previous Goal (TTS Phase 1 PR 3a — DONE 2026-05-03)

**PR 3a merged** (commit `e56e3e225` and surrounding rebase chain) after 5 review rounds + autosquash. Absorbed 10 PR-#957/958/959 review items + scaffolding (`TtsConfigCreateSchema`, `newTtsConfigId`, etc.). Notable round-3 finding: `voices.ts` exhaustive switch for `deleteVoiceAtProvider`, paired with `elevenLabsVoicesClient.ts` extraction to keep file under 400 lines. Round-5 (post-autosquash) flagged a half-handler asymmetry between exhaustive `delete` and sequential `if-checks` in `fetchAllTzurotVoices` — filed as PR 3c absorption.

---

## Stale: TTS Engine Upgrade Phase 1 kickoff (now superseded by PR 3a/3b status above)

(Original 2026-05-02 plan kickoff content below — kept for reference; PR 1 + PR 2 + PR 3a have all merged since.)

1. **Plan-mode pass** on the `TtsProvider` interface design and `tts_configs` schema (read `services/ai-worker/src/services/voice/` end-to-end first; the abstraction is mostly there in shape — `VoiceRegistrationService` + `ElevenLabsVoiceService` are parallel implementations of the same lifecycle pattern).
2. **Council review** of the proposed design (abstraction shape is the canonical "multiple viable approaches" case the project memory says to consult on).
3. **Phase 1 implementation** as a single PR: TTS preset infrastructure + Voxtral as first new provider. Estimated 1-2 evenings of focused work after design is locked.

**TL;DR of the locked decisions** (full context in `docs/proposals/backlog/tts-engine-upgrade-phase-1-plan.md`):

- BYOK Phase 1: **Mistral Voxtral via direct API (NOT OpenRouter)** — discovered late in 3-council review that OpenRouter only proxies `/audio/speech` and doesn't expose voices management; cloning requires direct Mistral API. Same $16/1M pricing, same model, ~85% cost reduction holds.
- Free tier: keep Kyutai/Pocket TTS, ADD NeuTTS Air alongside (additive design; deprecate Kyutai later only if NeuTTS Air clearly dominates)
- 3-council reconciled design: opaque `PreparedTts` discriminated union (stateful voiceId vs stateless inlineAudio), `capabilities` introspection on providers, `isFallbackEligible` on errors, `isAvailable()` gating, resolver-level `PreparedTts` cache, eviction mutex on stateful providers, audio format normalization at gateway, cost telemetry log line per call.
- Reference audio storage: existing api-gateway `/voice-references/{slug}` endpoint stays (verify canonical-format output during PR 1).
- Architecture order: build `TtsProvider` abstraction first, then plug providers in. 3-PR split: foundation → Mistral provider + dispatch → settings UX.
- Chatterbox: dropped — not CPU-viable on Railway.

**Pre-PR-1 gates (TOMORROW'S FIRST WORK)**:

1. **Set up Mistral account** (console.mistral.ai). Free tier covers smoke test.
2. **Smoke test Mistral API** (two-step curl): `POST /v1/voices` (base64 reference audio) + `POST /v1/audio/speech` (use returned voice_id). Document empirical request/response shapes in `docs/research/voice-cloning-2026.md`.
3. **Verify gateway audio format**: does `/voice-references/{slug}` return canonical PCM WAV 16-bit 24kHz mono today, or does it pass through raw user upload? Determines if `normalizeAudio()` helper is needed in PR 1.
4. **Auth plumbing decision**: does `auth.apiKey` carry the Mistral key when configured, or do we need a parallel `mistralApiKey?: string` field on `ResolvedAuth`?

Then start PR 1 implementation per the plan doc.

## Active Task

_None active. Beta.113 still in production, smoke-test cleared earlier today. Two PRs landed plus extensive backlog hygiene._

---

## This Session's Outcomes

### Direct-to-develop commits (doc/backlog hygiene)

- `e97dd24c5` — `docs(backlog): refresh stale focus + epic framing, triage 17 inbox items to deferred`. Refreshed `current-focus.md` (stale beta.108 reference fixed), `active-epic.md` (replaced quality-eval framing with perf+OpenRouter survey framing — superseded by today's research), and migrated 17 trigger-gated entries from `inbox.md` to `deferred.md`.
- `032acc1cf` — `docs(backlog): strike resolved items shipped via PR #954`. Removed legacy RateLimitCache entry, struck through z.ai diagnostic counter sub-bullet.
- `a592c2655` — `docs(backlog): remove resolved STT-skip-for-bot-authored-audio entry`. Cleared post-PR-#955.
- (pending this session-end commit) — TTS research doc extension + active-epic.md phased plan + CURRENT.md update.

### PRs merged

- **PR #954** (`9d18fa54a`) — `chore: warm-up cleanup bundle (RateLimitCache legacy / paren URL / z.ai reasoning counter)`. Three small inbox items shipped together: removed bounded-transitional legacy fallback in `RateLimitCache.parseStoredValue` (deleted 109 lines, added 48 — healthy negative diff), fixed `wrapUrlsForNoEmbed` to preserve balanced parens in URLs (regex+callback walker), extended `reasoningDebug` counters to recognize z.ai's `reasoning_content` field alongside OpenRouter's `reasoning`. 5 review rounds, all converged; the user approved a redundant-guard removal and a regex capture-group simplification along the way.

- **PR #955** (`50af387f2`) — `fix(bot-client): skip STT for forwarded own-bot voice messages`. Substantial fix: when a user forwards a persona's voice message, `BotMessageFilter` (which only checks the outer message author) passes the human forwarder through, but the inner snapshot's audio was getting transcribed via ElevenLabs/voice-engine — wasting STT cost AND feeding bot-generated voice back into LLM context as user input. Discord's `MessageSnapshot` strips author metadata from forwards so the only reliable signal is the attachment filename, which we control at upload time. New `botAudioClassifier.ts` recognizes filenames matching `{clientId}-{slug}-{timestamp}.{ext}` (e.g. `867653249611005983-lila-zot-lilit-mosr8tc0.mp3`) where clientId is THIS bot's Discord application ID — pinning identity per bot, with base36 timestamp avoiding Discord's automatic `(1)` suffix. Receive side checks the filename → if matched, skip STT and emit a placeholder reply (`🔁 *Forwarded voice message originally spoken by \`{slug}\` — original audio not re-transcribed.\*`). 4 review rounds, plan-mode + council review (Gemini 3.1 Pro Preview) before implementation. Council's clientId-vs-tzurot-prefix and timestamp-suffix refinements were both adopted. Backlog entry queued for Phase 2 buffer-hash text recovery (the v2 upgrade path that recovers actual TTS source text via audio-buffer hash → LRU cache, instead of placeholder).

### TTS Engine Upgrade research (largest substantive output of the day)

The user's "ElevenLabs is bleeding me dry" framing drove a deep research session. **Settled all the open epic decisions** that have been blocking implementation since the epic was promoted in April:

1. **OpenRouter TTS catalog surveyed** via `/api/v1/models?output_modalities=speech` — 8 TTS models confirmed, with cost + capability + reference-audio-range matrix.
2. **NeuTTS Air discovered** as the right cloning-capable self-hosted candidate (RTF < 0.5 on Intel i5, 400-600MB RAM, 3-15s reference, 85-95% speaker similarity). The original "Chatterbox for free users" plan was wrong-direction — Chatterbox isn't CPU-viable on Railway (verified via community RTF benchmarks). NeuTTS Air solves the same problem without the GPU requirement.
3. **Voxtral picked over Zonos for Phase 1 BYOK** — blind-test data is the strongest external quality signal (beats ElevenLabs Flash v2.5 in 68.4% of pairs); 3-30s reference range vs Zonos's 10-30s minimum (the user has reference audio shorter than 10s, so Zonos's floor would force re-recording or per-persona engine routing).
4. **Architecture revelation**: most of the abstraction the epic plan called for ALREADY EXISTS. `VoiceRegistrationService` (self-hosted) and `ElevenLabsVoiceService` (BYOK with sophisticated slot-eviction "musical chairs" logic) are parallel implementations of the same lifecycle pattern. The real Phase 1 work is **extract + generalize + add Voxtral**, not "build from scratch."
5. **Reference audio storage = solved** — existing api-gateway `/voice-references/{slug}` endpoint already serves reference audio for both providers. Migration of existing personas to Voxtral is just config change; no audio re-recording needed.
6. **Architecture-first decision locked**: per user's explicit preference ("build the abstraction so we can scale later"), Phase 1 builds `TtsProvider` interface + `tts_configs` cascade BEFORE plugging Voxtral in (they ship together in Phase 1).

Full survey + decision log captured in [`docs/research/voice-cloning-2026.md`](docs/research/voice-cloning-2026.md). Phased implementation plan in [`backlog/active-epic.md`](backlog/active-epic.md).

---

## Unreleased on Develop (since beta.114)

_(none — release-frozen until TTS Engine Upgrade Epic completes)_

---

## Previous Sessions

- **2026-04-30 → 2026-05-01** (extended marathon — 6 PRs merged + beta.113 release shipped): PRs #947–#952 (cache infrastructure, storage rename, createdAt test, release-finalize hook, 429 category preservation + GLM-4.7 leak strip, TTS chunker CRLF fix). Beta.113 shipped 2026-05-01 03:29 UTC; release-finalize hook from #950 protected the develop↔main resync (first release where the structural fix actually exercised against a real merge).
- **2026-04-30** (post-beta.112 inbox triage): 2 PRs merged on top of beta.112. PR #947 absorbed CACHE_KEY_PREFIXES centralization + `assertValidCacheKeyId` invariant + `logger.debug` opt-out. PR #948 disambiguated dual `MemoryDocument` types via storage-layer rename to `PgvectorMemoryDocument` + 4 new query-coverage tests.
- **2026-04-29 → 2026-04-30**: Six PRs merged + beta.112 release. PR #940 (vision pipeline cleanup), PR #941 (knip+guard:duplicate-exports blocking + dead-export deletion), PR #942 (rule update), PR #943 (Redis-backed rate-limit cache for OpenRouter 429s; 16 review rounds with mid-PR architectural pivot for CodeQL `js/insufficient-password-hash`), PR #944 (post-#943 cleanup bundle), PR #945 (Redis-backed credit-exhaustion cache for OpenRouter 402s).
- **2026-04-28 → 2026-04-29**: Cross-provider vision auth fix (#938) — discovered post-beta.110 that the "transient AUTH glitch" was deterministic z.ai-key-sent-to-OpenRouter mis-routing.
- **2026-04-28 → 2026-04-29**: Persona-owner DM participant leak fix (#932), DM-context message reference resolution (#933, #934, #936), vision negative-cache overhaul (#935), beta.110 cut (#937).
- **2026-04-27 → 2026-04-28**: z.ai integration end-to-end + beta.109 release.
- **2026-04-26 → 2026-04-27**: 11 PRs merged + Identity Hardening Epic CLOSED + post-deploy DM-silence resolved + new `09-interaction-style.md` rule + beta.108 cut (#919).
- **2026-04-25** (continuation of marathon): beta.105 production failures within minutes of deploy; PR #893 shipped beta.106 hotfix after 8 review rounds + real security bug catch (Teredo RFC 5952 canonical-form gap).
- **2026-04-24**: 7 PRs merged + new review-response rule + CI `fixup-check` job + workflow rule amendments + beta.105 cut (#892).
- **2026-04-23**: Identity Epic Phase 6 + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866.
- **2026-04-20**: v3.0.0-beta.102 released — Kimi K2.5 routing fix, hybrid post-action UX, CITEXT name uniqueness.
- **2026-04-19 / 2026-04-20**: v3.0.0-beta.101 released — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook, Phase 5c PR A/B.
- **2026-04-17**: Phase 5b shipped + beta.99 release — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

- **v3.0.0-beta.117** (2026-05-08) — Ten PRs in the bundle. Theme: Discord-interaction-correctness hardening + new `/character chat` random-bot mode + structural pre-commit hook for temporal markers. Headline UX wins: persona modal silent-truncation data-loss fix (#983, modal-limit alignment 2000→4000) and broad showModal 10062 wrapping across the dashboard surface (#985, #987, #988). New feature: `/character chat` with no character argument picks randomly from the user's accessible pool (#991). Tooling: pre-commit hook scans for temporal markers in code comments (PR refs, dates, "caught in round N") with companion `02-code-standards.md` rule section (#989). Rule clarification: `Deferred` backlog section now explicitly covers both declined items and trigger-gated work (#990). Cycle of 4 review rounds on #991, 4 on #988 — both LGTM-converged with progressively smaller findings.
- **v3.0.0-beta.113** (2026-05-01) — Six PRs in the bundle: #947 (cache infrastructure: CACHE_KEY_PREFIXES, cacheKeyId invariant, opt-out logging), #948 (storage-rename `MemoryDocument` → `PgvectorMemoryDocument` + queryMemories test coverage), #949 (createdAt mapping test), #950 (release-finalize hook), #951 (429 category preservation in cache + GLM-4.7 `<from_id>` leak strip), #952 (TTS chunker CRLF fix — RFC 7578 `\n` → `\r\n` wire expansion). Council-validated TTS chunker root cause (Gemini 3.1 Pro Preview) traced ~2000+N character expansion to multipart/form-data spec compliance.
- **v3.0.0-beta.112** (2026-04-30) — Six PRs: vision pipeline cleanup, knip/guard:duplicate-exports blocking, rule update on Dismissed-vs-Backlog distinction, Redis-backed rate-limit cache (16 review rounds with architectural pivot), credit-exhaustion cache, post-#943 misc cleanup bundle.
- **v3.0.0-beta.111** (2026-04-29) — Cross-provider vision auth fix (#938).
- **v3.0.0-beta.110** (2026-04-29) — Vision negative-cache overhaul (#935), DM persona-leak privacy fix (#932), DM-context message references (#933, #934, #936), pipeline refactor (#936).
- **v3.0.0-beta.109** (2026-04-28) — z.ai Coding Plan integration end-to-end functional.
- **v3.0.0-beta.108** (2026-04-27) — Post-deploy DM-silence resolved end-to-end across six PRs of progressive diagnosis. Identity & Provisioning Hardening Epic CLOSED (#911). IPv6 mixed-compression hardening in SSRF guard (#908). Repo improvements + new `09-interaction-style.md` rule (#915).
- **v3.0.0-beta.107** (2026-04-26) — Inspect UX hardening mini-epic completed; preset autocomplete fail-open fix (#906); SSRF defense-in-depth (#905); OpenRouter reasoning extraction switched from transport-layer body mutation to `__includeRawResponse` post-parse (#895); BACKLOG.md restructured into per-section files under `backlog/` (#904).
- **v3.0.0-beta.106** (2026-04-25) — Hotfix for beta.105 production failures: `safeExternalFetch` module with layered SSRF defenses, partial-success tolerance for attachment failures, error spoiler tags include actual failure detail. Council-reviewed (Gemini 3.1 Pro Preview). 8 review rounds with 1 real security bug caught by claude-bot (Teredo RFC 5952 canonical-form gap).
- **v3.0.0-beta.105** (2026-04-24) — Attachment download lifted from api-gateway to ai-worker (#889); downloadAll hardening (#890); transcription queue-age gate (#891); GLM-4.7 meta-preamble fix (#888); two-tier autocomplete cache (#884).
- **v3.0.0-beta.104** (2026-04-23) — shapes.inc cookie migrated Auth0 → Better Auth; GLM-4.5-air thought leak via Chain-of-Extractors pattern; new release tooling.
- **v3.0.0-beta.103** (2026-04-22) — Identity Epic Phase 5c PR C cutover; voice multi-chunk TTS Opus fix; `ApiCheck<T>` tri-state type.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- **[backlog/active-epic.md](backlog/active-epic.md)** - TTS Engine Upgrade epic (active)
- **[docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)** - Full TTS research + decision log
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
