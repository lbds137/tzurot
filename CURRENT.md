# Current

> **Session**: 2026-05-01 (single day, ~5 hours of focused work)
> **Version**: v3.0.0-beta.113 (released 2026-04-30 — no new release this session; ready to cut beta.114 when desired)

---

## Next Session Goal

**Kick off the TTS Engine Upgrade Epic Phase 1: plan-mode + council review on the architecture, then implement.** All decisions are locked; full research + rationale captured in [`docs/research/voice-cloning-2026.md`](docs/research/voice-cloning-2026.md) and the phased plan is in [`backlog/active-epic.md`](backlog/active-epic.md). Tomorrow's clean pickup point:

1. **Plan-mode pass** on the `TtsProvider` interface design and `tts_configs` schema (read `services/ai-worker/src/services/voice/` end-to-end first; the abstraction is mostly there in shape — `VoiceRegistrationService` + `ElevenLabsVoiceService` are parallel implementations of the same lifecycle pattern).
2. **Council review** of the proposed design (abstraction shape is the canonical "multiple viable approaches" case the project memory says to consult on).
3. **Phase 1 implementation** as a single PR: TTS preset infrastructure + Voxtral as first new provider. Estimated 1-2 evenings of focused work after design is locked.

**TL;DR of the locked decisions** (full context in the research doc):

- BYOK Phase 1: Voxtral (~85% cost reduction, blind-tested beats ElevenLabs Flash v2.5)
- Free tier: keep Kyutai/Pocket TTS, ADD NeuTTS Air alongside (additive design; deprecate Kyutai later only if NeuTTS Air clearly dominates)
- Reference audio storage: existing api-gateway `/voice-references/{slug}` endpoint stays
- Architecture order: build `TtsProvider` abstraction first, then plug providers in
- Chatterbox: dropped — not CPU-viable on Railway

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

## Unreleased on Develop (since beta.113)

- **PR #954** (`9d18fa54a`) — RateLimitCache legacy fallback removal + wrapUrlsForNoEmbed paren fix + reasoningDebug z.ai counter
- **PR #955** (`50af387f2`) — Skip STT for forwarded own-bot voice messages (filename-marker classification)
- Backlog hygiene direct commits (`e97dd24c5`, `032acc1cf`, `a592c2655`, plus this session-end commit)

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
