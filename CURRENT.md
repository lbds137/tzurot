# Current

> **Session**: 2026-04-29 (vision #940 + knip CI #941 + rule update #942 + rate-limit cache #943 + post-#943 cleanup #944)
> **Version**: v3.0.0-beta.111 (released 2026-04-29) — develop now ahead by PRs #940, #941, #942, #943, #944

---

## Next Session Goal

_All production-issues entries cleared. No active production bugs. Five PRs merged this session._

1. **402 credit-exhaustion cache PR (active fast-follow)** — Production-log investigation 2026-04-29 found 10× `code: 402` events from one user with a broken BYOK key (zero credits) hitting chat completions on `z-ai/glm-4.7`, NOT vision (the original backlog entry was mis-scoped). Each request burns ~70-440ms on a known-failed OpenRouter ping that returns the same "Account never purchased credits" 402. Fix shape: ~100-150 LOC similar to PR #943's `RateLimitCache` — new `CreditExhaustionCache` class, account-scoped key (`nocredits:openrouter:user:<discordId>`), TTL 1-4h (no provider-supplied reset signal), write on 402-with-credit-message, read at top of `invokeWithRetry` before rate-limit-cache check. Updated inbox entry reflects correct scope.
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local), feed it a character reference audio, compare quality vs. Pocket TTS and ElevenLabs. Cost-bleed-driven (~$200/mo ElevenLabs).
3. **Optional next release (beta.112)** — would bundle PRs #940/941/942/943/944. Production-driving piece is #943 (4-5min user-facing latency on rate-limited free-tier requests → <100ms fast-fail). #944 adds Discord-UX polish (URL embed-suppression in error messages).

## Active Task

_None. PR #944 merged 2026-04-29 — bundle of 2 mechanical cleanup items (MemoryDocument dedup + Discord URL embed-suppression). Single round of review with 0 actionable items, 8 ✅ verdicts, 2 backlog candidates added (third MemoryDocument in PgvectorTypes.ts; parenthesized-URL truncation in wrapUrlsForNoEmbed). After this session ends, next concrete pull-from is the 402 cache PR._

---

## Unreleased on Develop (since beta.111)

- **PR #944** (2026-04-29) — **Post-PR-#943 misc cleanup bundle**: (1) `refactor(ai-worker)`: deleted `services/context/PromptContext.ts` (duplicate `MemoryDocument` definition; pointed sole importer at canonical `ConversationalRAGTypes.ts` home); (2) `fix(common-types)`: new `wrapUrlsForNoEmbed` utility wraps bare http(s) URLs in `<…>` to suppress Discord auto-embed cards inside error spoilers (production rate-limit messages were rendering with embed previews of LangChain troubleshooting URLs). 2 commits, 5 files, +102/-18. Single round of review, 0 actionable items, 2 backlog candidates added. Transient claude-review auth flake on round 1 cleared via user rerun.

- **PR #943** (2026-04-29) — **Redis-backed rate-limit cache for OpenRouter 429s**. Production `:free`-tier daily-quota 429s previously burned 3 retry attempts × ~80s (4-5min user-visible latency); now the first 429 caches `{cacheKeyId, model} → resetMs` in Redis with TTL clamped to `[60s, 24h]`, and subsequent requests in the window short-circuit synthetically with `referenceId: 'rate-limit-cache-hit'` for trace clarity. Mid-PR architectural refactor (Option 5) replaced the SHA-256 fingerprint approach with opaque `cacheKeyId` (`user:<discordId>` or `'system'`) to resolve CodeQL `js/insufficient-password-hash` structurally instead of dismissing the alert (user policy: "uncompromising on security"). 16 review rounds, single squashed commit, monotonic convergence (3 issues → 1 medium + 2 polish → 0 actionable + 2 backlog). Gate added: `shouldRetryError` `instanceof ApiError` fast-path honors explicit `shouldRetry: false` overrides to prevent retry loops on the synthetic short-circuit.

- **PR #942** (2026-04-29) — **Rule update: distinguish Dismissed from Backlog candidates by future trigger** (`.claude/rules/08-review-response.md`). Codifies a misclassification pattern surfaced during PR #941 review: reviewer deferrals naming a future event/condition (`"monitor over time"`, `"if X happens"`) are Backlog candidates, not Dismissed. Adds new table row in rule 2's signal-conflict table, "Key question" decision-first framing, "pure-aesthetic deferral" definition with examples, and a per-round checklist item. 4 review rounds, all converged with explicit user intervention; rule itself routed its own round-4 reviewer observations correctly (validation that the new distinction is robust enough for self-application).

- **PR #941** (2026-04-29) — **Make `guard:duplicate-exports` + `knip` blocking in CI**. Tooling fixes: dedup logic for TS function overloads (false-positive class eliminated), regex super-linear-move anchor, ALLOWLIST extension. Real DRY violation fixed: `isForwardedMessage` consolidation across 3 importers. Dead-code removed: `PromptContext` + `TokenBudget` interfaces, `RecentLogsResponse`, `StuckExportCleanupResult` / `StuckImportCleanupResult`, `getDenylistCache`, `createMockReqRes`. `knip.json` configured with `ignoreExportsUsedInFile: true` (~99% noise reduction). 11 files, +78/-133 (net -55 LOC). 1 review round, 0 asks.

- **PR #940** (2026-04-29) — **Vision pipeline cleanup post PR #938**: 5-item bundle. `effectiveVisionModelName` helper extracted to `ProviderRouter.ts` and used by `visionAuthResolver` + `ImageDescriptionJob`. `USER_AUTH_PROBE_PROVIDERS` rewired to enum-derived list with `NON_LLM_PROVIDERS` filter — new LLM providers auto-include, ElevenLabs filtered as voice-only. Silent-fallback `logger.warn` added at `invokeVisionModel` chokepoint (interim signal before the eventual `visionProvider?` → `visionProvider` tightening; promote-when criterion: clean Railway logs for a few weeks). Hoisted double `MultimodalProcessor` lazy import in `DependencyStep`. Loud-failed 4 silent `vi.fn()` mock sites in `ImageDescriptionJob.test.ts`. 7 files, +199/-34. 2 review rounds, both convergent.

---

## Previous Sessions

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
