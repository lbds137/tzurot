# Current

> **Session**: 2026-04-26 → 2026-04-27 (extended marathon — DM-silence epic + Identity Hardening close-out + beta.108 release)
> **Version**: v3.0.0-beta.108 (released 2026-04-27)

---

## Next Session Goal

_No production issues active. z.ai integration end-to-end shipped (PR #921 + PR #924). Manual end-to-end verification + TTS upgrade work next._

1. **z.ai end-to-end manual verification** — per the plan in `~/.claude/plans/wondrous-rolling-moore.md`: (a) set z.ai-coding key via `/wallet add` → green validator response, (b) configure a personality with `provider: 'zai-coding'`, `model: 'glm-4.7'`, (c) send a Discord DM → check ai-worker logs for `effectiveProvider=zai-coding` and direct routing, (d) remove the key (or test as a different user) → check logs for `fallthroughTriggered=true` + `effectiveProvider=openrouter` with rewritten model `z-ai/glm-4.7`, (e) z.ai dashboard quota check confirms coding-plan quota was actually consumed (real-world signal). After verification, decide whether to seed a default `provider: 'zai-coding'` preset for users.
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local), feed it a character reference audio, compare quality vs. Pocket TTS and ElevenLabs. Cost-bleed-driven (~$200/mo ElevenLabs).
3. **Quick Wins remaining** — delete `DM_RAW_GATEWAY_DIAGNOSTIC` env entry from Railway dashboard (no code), "make duplicate-exports + knip blocking in CI" (needs allowlist triage first), and the new `createMockPersonality` redundant `provider: 'openrouter'` overrides sweep (~80 fixtures, mechanical).
4. **Beta release (when convenient)** — develop has 3 PRs unreleased since beta.108 (#920, #921, #924). Cut beta.109 when ready. Plan to fold the `claude-review` skip-on-dependabot workflow change into the same release branch (it's the last-commit-before-release-merge item per the quick-wins entry — needs to land on develop alongside the release-merge PR to minimize the dark window where claude-review is broken).

## Active Task

_None. PR #924 (z.ai PR 2 of 2 — `ProviderRouter` + auto-fallthrough wiring) merged 2026-04-27 after 8 review rounds. The `provider` field is now plumbed end-to-end from DB → MappedLlmConfig → LoadedPersonality → effectivePersonality → ModelConfig, with `ProviderRouter` encoding the auto-fallthrough decision (zai-coding without user key → rewrite to `z-ai/<model>` and route via OpenRouter), `validateAIProvider` providing a defensive runtime guard at the ModelFactory boundary, and `ProviderUnavailableError` symmetrically classifying 5xx in all three validators. **Next**: end-to-end manual verification on dev (Railway auto-deploys develop pushes) before any preset seeding work._

---

## Unreleased on Develop (since beta.108)

- **PR #920** (`chore/post-beta-108-cleanup`, merged 2026-04-27) — chunker defensive truncation against off-by-N output (real Lilith bug), shutdown async-await (PR #913 follow-up), `CreatePersonaResponse` schema import (drift prevention).
- **PR #921** (`feat/zai-coding-provider-plumbing`, merged 2026-04-27) — z.ai Coding Plan as new `AIProvider.ZaiCoding` enum + endpoint + key validators (api-gateway intake + ai-worker runtime) + `ModelFactory` per-request provider override with provider-tier param filtering. PR 1 of 2; routing & auto-fallthrough come in PR 2. 6 review rounds, all asks resolved or absorbed into PR 2 backlog.
- **PR #924** (`feat/zai-coding-provider-router`, merged 2026-04-27) — z.ai PR 2 of 2: `ProviderRouter` (new service, 13 unit tests) encodes auto-fallthrough rule (zai-coding-with-key → direct route; zai-coding-without-key → rewrite to `z-ai/<model>` and route via OpenRouter; non-zai providers → passthrough). Wired into `AuthStep` via extracted `resolveLlmAuth()` helper. Threaded `provider` field end-to-end through `MappedLlmConfig` → `LoadedPersonality` → `ModelConfig`. Added `validateAIProvider()` runtime guard at ModelFactory boundary. Promoted 5xx classification to `ProviderUnavailableError` symmetrically across OpenRouter/ElevenLabs/ZaiCoding validators (was an asymmetric latent bug). 8 review rounds, all asks resolved or backlogged.
- **Dependabot PRs #922/#923** (merged 2026-04-27) — production + development dependency updates. Merged with explicit `claude-review` infra-fail (bot-actor reject); workflow fix to skip claude-review on dependabot is queued in `backlog/quick-wins.md` as "last commit on develop before next release-merge."

---

## Previous Sessions

- **2026-04-26 → 2026-04-27**: 11 PRs merged (#908, #909, #910, #911, #912, #913, #914, #915, #916, #917, #918) + Identity Hardening Epic CLOSED + post-deploy DM-silence resolved end-to-end across six PRs of progressive diagnosis + new `09-interaction-style.md` rule + beta.108 cut (PR #919).
- **2026-04-25** (continuation of marathon): beta.105 production failures observed within minutes of deploy; audit + council consultation surfaced 3 critical hardening items; PR #893 shipped beta.106 hotfix after **8 review rounds** and a real security bug catch (Teredo RFC 5952 canonical-form gap, found by claude-bot).
- **2026-04-24**: 7 PRs merged + new review-response rule + CI `fixup-check` job + workflow rule amendments + beta.105 cut (PR #892).
- **2026-04-23**: Identity Epic Phase 6 + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866.
- **2026-04-20**: v3.0.0-beta.102 released — Kimi K2.5 routing fix, hybrid post-action UX, CITEXT name uniqueness.
- **2026-04-19 / 2026-04-20**: v3.0.0-beta.101 released — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook, Phase 5c PR A/B.
- **2026-04-17**: Phase 5b shipped + beta.99 release — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

- **v3.0.0-beta.108** (2026-04-27) — **Post-deploy DM-silence resolved end-to-end** across six PRs of progressive diagnosis (SIGTERM handler #913, Partials.Message + User #914, diagnostic listeners #915, DM cache warmer #916, startup pre-warm Layer 1 #917, retry-with-backoff for startup race #918). **Identity & Provisioning Hardening Epic CLOSED** (#911) — `requireProvisionedUser` middleware tightened to strict 400/403/500, `getOrCreateUserShell` deleted, -1404 lines net. **IPv6 mixed-compression hardening** in SSRF guard (#908). Repo improvements: vestigial `setAsDefault` removed (#912), test-utils consolidation (#909), MOCK_USER_ID UUID normalization (#910), `09-interaction-style.md` rule promotion (#915).
- **v3.0.0-beta.107** (2026-04-26) — Inspect UX hardening mini-epic completed: stateful filter / sort / Top-N buttons on Memory Inspector (#901), Pipeline Health checklist + quick-copy summary (#899), owner-only redaction of character internals (#898), embed redesign for the post-#895 diagnostic shape (#897). **Preset autocomplete fail-open fix** (#906) — wallet-API failures no longer hide paid models from users with active keys. SSRF defense-in-depth: `discordCdnGuard` helper now applied at every attachment fetch site including the JSON-download utility (#905); IPv6 loopback Set covers uncompressed form. Internal: OpenRouter reasoning extraction switched from transport-layer body mutation to `__includeRawResponse` post-parse (#895), three-layer canary safety net (#896). BACKLOG.md restructured into per-section files under `backlog/` (#904). Pre-push hook now clears depcruise cache (#902).
- **v3.0.0-beta.106** (2026-04-25) — Hotfix for beta.105 production failures: external embed images (Reddit/Imgur/Tenor) now reach the LLM via new `safeExternalFetch` module with layered SSRF defenses (DNS-resolution + IP-range guards including IPv4-mapped/6to4/Teredo recursion, browser User-Agent, Content-Type assertion); single bad URL no longer aborts whole conversation (partial-success tolerance in DownloadAttachmentsStep); bot error replies now include actual failure detail in spoiler tag instead of generic "Sorry, I encountered an error" (errorInfo populated in pipeline catch); VisionProcessor SSRF theater dropped (LLM provider does the fetch). Council-reviewed (Gemini 3.1 Pro Preview). 8 review rounds with 1 real security bug caught by claude-bot (Teredo RFC 5952 canonical-form gap).
- **v3.0.0-beta.105** (2026-04-24) — Attachment download lifted from api-gateway to ai-worker (#889); downloadAll hardening + 50 MiB aggregate cap (#890); transcription queue-age gate (#891); GLM-4.7 meta-preamble fix (#888); two-tier autocomplete cache (#884); identity Phase 6 part 2 + ESLint rule (#881, #882); pglite CHECK constraints (#887); typing-indicator classifier (#886); autocomplete sentinel guards (#885); uuid CVE pin.
- **v3.0.0-beta.104** (2026-04-23) — shapes.inc cookie migrated Auth0 → Better Auth; GLM-4.5-air thought leak via Chain-of-Extractors pattern; new release tooling; bot-client submit-job timeout bump.
- **v3.0.0-beta.103** (2026-04-22) — Identity Epic Phase 5c PR C cutover; voice multi-chunk TTS Opus fix; `ApiCheck<T>` tri-state type; tech-debt paydown.
- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX, Kimi K2.5 routing fix, CITEXT name uniqueness.
- **v3.0.0-beta.101** (2026-04-20) — Preset clone PK fix, TTS Opus transcode default, Phase 5c PR A/B.
- **v3.0.0-beta.100** (2026-04-17) — `/admin db-sync` refactor, character truncation warning, protobufjs CVE.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
