# Current

> **Session**: 2026-04-29 → 2026-04-30 (six PRs merged + beta.112 release cut)
> **Version**: v3.0.0-beta.112 (released 2026-04-30) — develop is at the release baseline

---

## Next Session Goal

_All production-issues entries cleared. No active production bugs. Six PRs merged + release cut + Railway prod auto-deploying._

1. **Post-deploy validation of beta.112** — Confirm the new caches fire in production:
   - Search Railway prod for `"Cached rate-limit state"` (write) + `"Skipped LLM call — rate-limit cache hit"` (read) — fires when next 429 surfaces on a `:free` model
   - Search for `"Cached credit-exhaustion state"` + `"Skipped LLM call — credit-exhaustion cache hit"` — fires when next zero-credit BYOK account hits 402
   - Behavioral confirmation: cache hits show `<100ms` instead of `~70-440ms` per request
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local), feed it a character reference audio, compare quality vs. Pocket TTS and ElevenLabs. Cost-bleed-driven (~$200/mo ElevenLabs).

## Active Task

_None. v3.0.0-beta.112 shipped 2026-04-30 with all six session PRs (#940/941/942/943/944/945). Release-PR holistic review converged with 0 blocking items, 6 ✅ strengths, 1 backlog candidate added (KEY_PREFIX duplication across cache services + tooling)._

---

## Unreleased on Develop (since beta.112)

_Empty — develop is at the release baseline._

---

## Previous Sessions

- **2026-04-29 → 2026-04-30**: Six PRs merged + beta.112 release cut. PR #940 (vision pipeline cleanup post PR #938: `effectiveVisionModelName` helper, enum-derived `USER_AUTH_PROBE_PROVIDERS`, silent-fallback warn). PR #941 (made `guard:duplicate-exports` + `knip` CI checks blocking; fixed TS function overload dedup logic; deleted 6 dead exports; `isForwardedMessage` DRY consolidation). PR #942 (rule update: distinguish Dismissed from Backlog candidates by future trigger). PR #943 (Redis-backed rate-limit cache for OpenRouter 429s; 16 review rounds with mid-PR architectural pivot to resolve CodeQL `js/insufficient-password-hash` structurally; turns 4-5min user-visible latency into <100ms fast-fail). PR #944 (post-#943 misc cleanup bundle: MemoryDocument dedup + `wrapUrlsForNoEmbed` utility for Discord URL embed-suppression). PR #945 (Redis-backed credit-exhaustion cache for OpenRouter 402s with new `CREDIT_EXHAUSTION` error category, JSON cache shape `{ ts, ttl }` for accurate remaining-time, operator escape valve `pnpm ops cache:clear-credit-exhaustion`). PR #946 release-PR holistic review converged 0-blocking. v3.0.0-beta.112 shipped 2026-04-30; Railway prod auto-deployed.

- **2026-04-28 → 2026-04-29 (continued)**: Cross-provider vision auth fix (#938) — discovered post-beta.110 deploy that the "transient AUTH glitch" was actually deterministic z.ai-key-sent-to-OpenRouter mis-routing. 13 review rounds, single fixup-squashed commit. User-verified on dev. Beta.111 cut to land it in prod.
- **2026-04-28 → 2026-04-29**: Persona-owner DM participant leak fix (#932), DM-context message reference resolution (#933, #934, #936), vision negative-cache overhaul + observability (#935), bundled cleanup PR (#936), beta.110 cut (#937). Vision cache architecture: dropped L2 PostgreSQL entirely, decoupled cache TTL policy from retry policy via `VISION_FAILURE_CACHE_POLICY`, added source-aware fallback strings. Council-validated (Gemini 3.1 Pro Preview). Both dev + prod migrations applied.
- **2026-04-27 → 2026-04-28**: z.ai integration end-to-end + beta.109 release.
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

- **v3.0.0-beta.111** (2026-04-29) — **Cross-provider vision auth fix** (#938): root-cause fix for the "vision permanently broken" symptom that beta.110 architecturally mitigated. When a personality has main model on one provider (e.g., z.ai-coding `glm-5.1`) and vision-model override on another (e.g., OpenRouter `qwen/qwen3.5-...`), API key resolution now happens **per-provider** instead of inheriting the main-model key. New `visionAuthResolver.ts` seam + `detectVisionProvider` helper enforce a fail-fast policy: authenticated users without a key for the vision provider get a "configure your /wallet" message rather than silently consuming the system key. Both the channel-history path (`DependencyStep`) and the direct-upload path (`ImageDescriptionJob`) share the same decision tree + fallback string. Plus: `ResolvedAuth.provider` narrowed to `AIProvider | undefined` (was `string | undefined`), `logSanitizer` allowlist for `apiKeySource` metadata field. 13 review rounds, council-validated, user-verified on dev pre-release.
- **v3.0.0-beta.110** (2026-04-29) — **Vision negative-cache overhaul** (#935): drops L2 PostgreSQL cache (`image_description_cache` table dropped), decouples per-category TTL from retry policy (`VISION_FAILURE_CACHE_POLICY` map: 5min for AUTH/QUOTA, 60min for attachment-bound, 10min for transient), adds source-aware fallback strings (system-key glitches → "vision service temporarily unavailable" instead of "your API key was rejected"), adds `userId/apiKeySource/cachedAt/personalityName/jobId/provider` to failure logs. **Privacy fix** (#932): personality-field-resolved users no longer leak into other users' DM contexts via `about_user`. **DM-context message references** (#933, #934, #936): native replies + pasted DM links now resolve in DMs and out-of-DM contexts. **Pipeline refactor** (#936): vision-pipeline options-object pattern drops 4 max-params suppressions; CI-enforced invariant tests for `ATTACHMENT_BOUND_FAILURE_CATEGORIES` ↔ `VISION_FAILURE_CACHE_POLICY` ↔ `FAILURE_LABELS`. ProviderRouter `ResolvedRoute` mutual-exclusion runtime guard. Council-validated (Gemini 3.1 Pro Preview).
- **v3.0.0-beta.109** (2026-04-28) — z.ai Coding Plan integration end-to-end functional.
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
