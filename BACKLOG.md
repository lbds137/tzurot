# Backlog

> **Last Updated**: 2026-04-25
> **Version**: v3.0.0-beta.106 (released — next unreleased bundle starts fresh on develop)

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

- 🐛 `[FIX]` **LangChain reasoning extraction intermittently drops content (~11% on GLM-4.7, also seen on Gemma 4)** — **See [`docs/research/langchain-reasoning-extraction-bug.md`](docs/research/langchain-reasoning-extraction-bug.md) for the full investigation playbook.** TL;DR: our `OpenRouterFetch` interceptor extracts `message.reasoning` and injects `<reasoning>` tags into `message.content`. MOST of the time those tags survive — `/inspect` shows the extracted reasoning correctly (~89% on GLM-4.7 per prod data). But ~11% of GLM-4.7 requests, the tags vanish between our interceptor's `reasoningInjected=true` log and the diagnostic's `hasReasoningTagsInContent: false` capture. Confirmed via Railway logs from the prior deployment that the interceptor extracted 1994 chars correctly for the user's leaked request; tags then disappeared somewhere in LangChain's response-handling pipeline. Failure also observed on Gemma 4 (small sample, 3/4 = 75%), which **rules out "GLM-4.7-specific" framing** — this is a cross-model intermittent failure. Two visible symptoms when it fires: (a) `/inspect` loses audit data; (b) when the model ALSO embedded planning prose in `content` (separate phenomenon), user sees the leak because we're not masking it with structured reasoning. **Investigation doc has**: smoking-gun evidence (Railway logs from prior deployment), four ranked hypotheses (H3/H4 promoted because they explain intermittent behavior; H1/H2 demoted because they'd produce universal failure), ordered test plan starting with `scripts/src/test-glm-reasoning-shape.ts`, all diagnostic scripts in `scripts/src/`, links to relevant code paths. Surfaced 2026-04-25 by user inspect-log review post beta.106 release; reframed 2026-04-25 after user correction that `/inspect` does work most of the time.

- 🐛 `[FIX]` **Guest mode erroneously triggers in preset autocomplete** — Surfaced 2026-04-25 by user observation. When a logged-in user starts typing in a preset-related autocomplete, guest-mode behavior kicks in intermittently (results show guest-only presets, or default-fallback paths fire instead of the user-scoped query). Reproduces "at times" — likely a timing/race condition rather than a hard logic bug. **Action**: trace the autocomplete handler's user-scope resolution (presumably `req.userId` derivation in the preset autocomplete route) and look for paths where `userId` is undefined/null when it shouldn't be. Suspect: missing `await` or auth-middleware ordering in the autocomplete-specific gateway path. **Start**: `services/bot-client/src/utils/autocomplete/` and the preset autocomplete handler; cross-reference `services/api-gateway/src/routes/` for the autocomplete endpoint. Reproduce by typing into a preset autocomplete repeatedly and watching for guest-only presets to leak in.

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

- 🐛 `[FIX]?` **Vision processor returns abort error instead of 429 for overloaded upstream** — Surfaced 2026-04-25 by user observation: when Gemma 4 returned an "overloaded" response, the vision processor surfaced an `abort error` rather than classifying as 429 (rate-limit). User asked: "is this correct?" — needs investigation before classifying as bug or expected behavior. **Action**: trace the vision processor's error-handling path for upstream 429s; check whether the abort surface is masking a 429, or whether Gemma 4's specific overload response shape lacks the 429 status code that classification relies on. May need to extend the classifier to recognize Gemma's overload response. **Start**: `services/ai-worker/src/jobs/ImageDescriptionJob.ts` error path + `apiErrorParser`.

- ✨ `[FEAT]` **Preset dashboard "set as default" button** — Surfaced 2026-04-24 by user. Add a button to the preset dashboard that lets a user adopt a preset as their personal default in one click; admins additionally see a "set as global default" option. Currently the workflow requires navigating to user-settings (or admin-settings) to set defaults, which is friction when browsing presets. **Why Inbox not Quick Wins**: needs design call on (a) button placement in dashboard, (b) confirmation UX for admin global-default (potentially destructive), (c) how the button reflects current state (e.g. disabled when already default). Surfaced 2026-04-24.

- ✨ `[FEAT]` **User-facing notice when partial attachment failures occur** — Beta.106's hotfix (PR #893) lets the conversation proceed when only some attachments succeed (deliberately better than aborting the whole thread on one bad URL). Side effect: a user forwarding a 5-image post where 2 succeed and 3 fail will see the bot respond to only the 2 surviving images with no indication that 3 were dropped. The response may appear unexpectedly sparse. **Fix shape**: emit a lightweight ephemeral notice ("⚠️ 3 of 5 attachments couldn't be loaded — link expired or external host blocked") alongside the normal response, tied to the per-attachment failure list already produced by `DownloadAttachmentsStep`. Surface via `errorInfo`-style structured field on the success result (e.g. `partialFailures?: string[]`), then bot-client renders the notice. **Why deferred**: hotfix scope; need design call on ephemeral vs. inline placement and on per-failure detail vs. summary count. Surfaced 2026-04-25 by claude-bot review on PR #893 (minor).

---

## 🎯 Current Focus

_This week's active work. Max 3 items._

### Identity Hardening — final cleanup (post-epic)

The Identity & Provisioning Hardening Epic shipped end-to-end as of 2026-04-23 (Phases 1–6; see `docs/reference/architecture/epic-identity-hardening.md`). Two small follow-ups remain, sequenced as one atomic bundle:

- 🧹 **Tighten `requireProvisionedUser` shadow-mode to strict 400** — `services/api-gateway/src/services/AuthMiddleware.ts:193-204` already plans this cutover. Safe once prod canary stays clean for 48-72h (earliest: ~2026-04-25). Middleware returns 400 on missing/malformed user-context headers instead of falling through. Removes the fallback branch from `resolveProvisionedUserId` + `getOrCreateInternalUser`. **Prerequisite migration (already landed in PR #882)**: `createProvisionedMockReqRes` helper in `services/api-gateway/src/test/shared-route-test-utils.ts`. The route test files currently mock `requireProvisionedUser` as a no-op. The strict-cutover PR applies the helper to every test file before flipping the middleware — migration + strict flip as one atomic change.
- 🧹 **Delete `getOrCreateUserShell` method + canary log + helper fallback branches** — After the shadow-mode tightening above lands and canary confirms zero hits, the shell path is truly dead. Delete `UserService.getOrCreateUserShell` + its `[Identity] Shell path executed` canary log at `packages/common-types/src/services/UserService.ts:215`. Both `resolveProvisionedUserId` and `getOrCreateInternalUser` collapse to passthroughs reading `req.provisionedUserId` directly. **Also update `eslint.config.js:56`**: the existing ban on direct `prisma.user.create/upsert/createMany` currently names `getOrCreateUserShell` as the canonical HTTP-route alternative — remove that reference when the method is deleted.

### Post-deploy DM subscription loss fix

🐛 `[FIX]` **HIGH priority** — user-facing friction on every release. Every time we ship a release and bot-client restarts, **plain-text DMs silently fail until the user fires a slash command** in the DM. Slash commands work (they go through `interactionCreate` which establishes the DM channel as a side effect). Guild messages work. Only plain-text `MESSAGE_CREATE` events in DMs get dropped on Discord's side.

**Root cause**: Discord doesn't automatically re-subscribe a bot to existing DM channels on gateway reconnect. DM channel subscriptions are per-bot-per-user and ephemeral across bot reconnects. When user DMs a bot that has no active subscription to their DM channel, Discord silently drops the message. Slash-command interactions trigger `POST /users/@me/channels` implicitly, re-establishing the subscription. Once re-subscribed, plain-text DMs route normally until the next bot restart.

**Observed**: 2026-04-20 (initial report, misdiagnosed as user-install state), 2026-04-22 (beta.103 release night, pattern confirmed by user noting correlation with every deploy). The prior "deauth + reauth" mitigation was partially effective because reauth forced the Discord client to re-open the DM channel, incidentally re-subscribing the bot.

**Two-layer fix (belt-and-suspenders)**:

**Layer 1 — Startup pre-warming**: on bot-client `ClientReady`, fetch all Discord IDs of users active in the last N days (30 or 90) from api-gateway, then rate-limited loop `client.users.fetch(id).createDM()` on each. Handles cold-start case so existing users don't need to interact first.

**Layer 2 — Greedy lazy registration**: on any user interaction (message received in guild OR DM, slash command, button, select menu, modal, autocomplete), greedily call `createDM()` for that user's Discord ID. Memoize via in-memory `Set<userId>` so we only fire once per user per bot lifetime. This is the correctness guarantee — any user we see, in any context, gets a live DM subscription established within their first interaction post-restart. Memoization set clears on restart naturally, matching Discord's own subscription lifecycle.

**Architecture**: centralize in a `DMSubscriptionWarmer` service (bot-client), memoizes via `Set<userId>`, rate-limits via simple queue (~10 req/sec to respect Discord's `POST /users/@me/channels` bucket). Both layers funnel through the same service — startup = batch-mode loop, greedy = per-interaction single call.

**Changes needed**:

- (a) new endpoint `GET /internal/users/recent?sinceDays=30` on api-gateway (service-auth protected, returns Discord IDs only) — for Layer 1
- (b) new `DMSubscriptionWarmer` service in `services/bot-client/src/services/` with queue-based rate limiting
- (c) wire Layer 1 into `services/bot-client/src/index.ts` after `Events.ClientReady`, before "fully operational"
- (d) wire Layer 2 into `MessageHandler.handleMessage` (for every non-bot, non-system message) and the `interactionCreate` handler (for every interaction)
- (e) fire-and-forget throughout; log warming progress + failures; circuit-breaker on 429s

**Acceptable residual**: a brand-new user who has never interacted with the bot at all (not in a guild, never triggered a slash command, truly first contact via DM) still needs to slash-command first. Unavoidable without bot-initiated DM creation, which Discord doesn't allow. Layer 2 shrinks this edge case to "first-ever interaction only."

**Start**: `services/bot-client/src/services/` for the new warmer service; `services/bot-client/src/index.ts` around line 256 (`Events.MessageCreate` handler) and 267 (`Events.InteractionCreate`) for Layer 2 wire-up; `services/api-gateway/src/routes/` for the new endpoint.

Promoted from Inbox 2026-04-22.

### Other in-flight

_None beyond the above. TTS Engine Upgrade is Active Epic._

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- 🛡️ `[FIX]` **Uncompressed IPv6 loopback gap in `isPrivateOrInternalIpv6`** — `0:0:0:0:0:0:0:1` (uncompressed form of `::1`) satisfies `isIPv6()` but doesn't match the `lower === '::1'` comparison, so returns `false` (treated as public). **NOT exploitable through current call path**: `validateExternalImageUrl` rejects IP literals as hostnames AND `dns.lookup` returns RFC 5952 canonical form (`::1`). Defense-in-depth gap that surfaces only if `isPrivateOrInternalIp` gets reused in a new context. Surfaced 2026-04-25 by claude-bot review on release PR #894. **Fix shape**: add `lower === '0:0:0:0:0:0:0:1'` (and possibly other zero-padded variants) to the loopback check + a test case. ~3 min.

- 🧹 `[CHORE]` **Handler-level test for `MEDIA_NOT_FOUND` classification in `LLMGenerationHandler` catch** — `LLMGenerationHandler.test.ts` only covers `errorInfo` population on the GenerationStep failure path (which classifies as `UNKNOWN`). The DownloadAttachments → `MEDIA_NOT_FOUND` mapping at `LLMGenerationHandler.ts:117` has unit-level coverage in `DownloadAttachmentsStep.test.ts` (the throw-when-no-text case) but no integration-level coverage that asserts the classification reaches `result.errorInfo.category`. A future refactor could silently break the step-name check. **Fix shape**: add a test that mocks `DownloadAttachmentsStep.prototype.process` to throw and verifies `result.errorInfo.category === ApiErrorCategory.MEDIA_NOT_FOUND`. Surfaced 2026-04-25 by claude-bot review on PR #893 round 7. ~15 min.

- 🛡️ `[FIX]` **Bot-client direct fetches lack explicit hostname validation** — `services/bot-client/src/commands/character/avatar.ts:73-92` and `services/bot-client/src/commands/character/import.ts:180-214` directly `fetch(attachment.url)` after a MIME-type check only. The URL source is the Discord interaction object, so it's implicitly safe (Discord's API only ever supplies CDN URLs), but there's no explicit guard. `services/bot-client/src/commands/character/voice.ts:97-110` does it correctly with a `DISCORD_CDN_HOSTS` allowlist check. **Fix shape**: extract the voice.ts allowlist check into a shared helper, apply at all three sites. **Why deferred**: defense-in-depth, no known exploit path. Surfaced 2026-04-25 during beta.106 hotfix audit.

- ⚡️ `[PERF]` **Cache `personalityOwnerResolver` lookups (TTL ~5min)** — Surfaced 2026-04-25 by claude-bot review of PR #898. `services/ai-worker/src/services/diagnostics/personalityOwnerResolver.ts:resolvePersonalityOwnerDiscordId` fires a `prisma.user.findUnique` on every AI generation request to look up the personality owner's Discord ID for diagnostic-meta. Ownership is stable (personalities almost never change owners) so this is a good fit for short-TTL caching. Options: (a) thin wrapper around an in-memory `TTLCache<string, string|null>` with 5-min TTL keyed by `personalityOwnerInternalId`; (b) extend `UserService` with a cached `getDiscordIdByInternalUuid` method that other consumers could also use. (b) is more reusable; (a) is simpler if no other consumer surfaces. **Why deferred**: the lookup is fast (single indexed query, ~1ms typical) and not on a hot path that's been profiled as a bottleneck. Cache adds invalidation complexity. Promote when generation latency is being tightened or this query is identified as a material p95 contributor. **Start**: profile the resolver call in production diagnostic logs before optimizing — confirm the actual cost first.

- 🧹 `[CHORE]` **Wrap individual pipeline steps in try/catch so `PipelineStep.status: 'error'` is reachable** — Surfaced 2026-04-25 by claude-bot review of PR #899. The schema declares `'success' | 'skipped' | 'error'` and `extendedViews.ts` renders the ❌ icon for it, but `DiagnosticCollector.recordPostProcessing()` currently only emits `success` / `skipped`. If a step throws today, the whole `recordPostProcessing` call dies and `pipelineSteps` is never set — the failure is invisible to the Pipeline Health view rather than surfaced in it. **Fix shape**: wrap each of the 4 step blocks (duplicate_removal, thinking_extraction, artifact_strip, placeholder_replacement) in its own try/catch; on catch, emit `{ name, status: 'error', reason: err.message }` and log via the collector's logger. **Not urgent**: post-processing transforms are simple string operations that don't realistically throw today. Promote when the pipeline grows steps that do real I/O (vector lookups, external API calls) or when adding the first step that can legitimately fail. **Start**: refactor the array-build in `recordPostProcessing` so each step is a try/catch returning a `PipelineStep` rather than a positional ternary expression.

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.

---

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

---

## 📦 Future Theme: CPD Clone Reduction

_Focus: Reduce code clones to <100. Demoted from Next Epic 2026-04-21 when TTS promoted; resume after TTS Epic completes._

**Progress**: 175 → 127 (PRs #599, #665–#668); grew to 152 from features; PR #729 → 146; 2026-04-06 architecture day (PRs #766, #768, #769) → 137; PR #776 (browse footer helpers) → 126; Session 1 (PRs #778, #779) → 118; PR #785 (ElevenLabs `readBody` extraction) → 119; 2026-04-13 quick wins session (PRs #794-798, thinking tags data-driven, BrowseActionRow extraction, routeHelpers split) → 119. **Current (`develop`): 119.** BrowseActionRow and thinking tag dedup were type/regex clones not counted by CPD; runtime code clone count unchanged.

### Completed (Phases 1-4)

Phases 1-4 shipped in PRs #599, #665-#668, #704 — Redis setup factory, error reply helpers, route test utilities, personality formatters, API gateway route boilerplate extractions. See git history for details.

### Phase 5: Bot-Client Dashboard Patterns (~16 clones)

Session/ownership boilerplate and modal/select handling repeated across all dashboard commands.

- [ ] Standardize `requireDashboardSession` utility — session lookup + expiry + ownership check (8 clones across settings, preset, persona, deny dashboards)
- [ ] Extract `handleDashboardModalSubmit` — section lookup + value extraction + API call + refresh (4 clones)
- [ ] Extract `handleDashboardSelectMenu` — edit prefix parsing + section lookup (2 clones)
- [ ] Deduplicate persona profile section config — single source of truth between `config.ts` and `profileSections.ts` (3 clones)

### Phase 6: Bot-Client Command Patterns (~15 clones)

Subcommand routing, browse/pagination, custom IDs, and command-specific duplication.

- [ ] Consolidate subcommand routers — parameterized router with context-type generic (3 clones)
- [x] Migrate browse consumers to `browse/` utilities, delete `paginationBuilder.ts` (4 clones) — PRs #771-776
- [x] Servers command: use `createBrowseCustomIdHelpers` instead of inline parsing (4 clones) — PR #773
- [ ] Extract memory command shared helpers — `formatMemoryLine` (remaining clones)

### Phase 7: Cross-Service & Common-Types (~15 clones)

Shared types, config resolver patterns, and remaining cross-service duplication.

- [x] Define `PersonalityFields` type in common-types — `PersonalityCharacterFields` interface + Zod schema fragment (4 files updated)
- [ ] Extract `CacheWithTTL` base — cleanup interval + user-prefix invalidation (6 clones across config resolvers)
- [x] DRY personality create/update Zod schemas — use `.extend()` (2 clones) — already implemented via `...PersonalityCharacterFieldsSchema.shape` composition in `PersonalityCreateSchema` and `PersonalityUpdateSchema` (confirmed during Session 1 investigation, 2026-04-11)
- [ ] Extract `sessionContextFields` Zod fragment — shared between jobs.ts and personality schemas (1 clone)
- [ ] ResultsListener: use shared `createIORedisClient` factory (1 clone)

### Phase 8: AI Worker + Tooling (~10 clones)

Smaller wins in ai-worker internal patterns and tooling utilities.

- [ ] Extract `createStuckJobCleanup(model, config)` factory (2 clones)
- [x] Extract `handleShapesJobError` shared error handler — `shapesJobHelpers.ts` factory with callbacks
- [ ] Extract tooling `spawnWithPiping` and shared `execFileSafe` helpers (3 clones)
- [ ] Extract migration preamble helper (`validateEnvironment` + banner + client) (2 clones)

### Remaining (~10 clones)

Small, localized duplication (1-2 clones each) across deny commands, shapes formatters, preset import types, autocomplete error handling, avatar file ops. Fix opportunistically.

**Target**: <100 clones or <1.5%. Currently 119 clones on develop.

---

## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

### Theme: Shapes.inc Fetcher Hardening (multi-item mini-epic)

_Focus: harden the shapes.inc data-fetch path against API drift, bot-protection, and graceful failure — companion to the cookie migration (shipped beta.103)._

Web Claude's companion recommendations to the cookie-migration guide. Each item is individually pickable; bundling avoided (they touch different concerns) and full-rewrite avoided (current design is clean).

**High-value (4 items)**:

1. **Schema-drift canary** — Zod-validate top-level response shapes at each endpoint, log `warn` not `throw` on missing fields so partial exports still complete.
2. **Persist raw JSON alongside typed output** — cheap schema resilience + user-data-portability win (users may need fields we haven't surfaced).
3. **Detect bot-protection** — header-check for `cf-ray`/`cf-mitigated`/`x-px-*`/`x-datadome` + HTML-on-JSON-endpoint, throw a distinct `ShapesBotProtectionError` so the failure mode is obvious vs confusing 403s.
4. **Fallback docs** — README section "If this tool stops working" pointing users to GDPR/CCPA data-access-request rights with a template (fast-path vs legally-guaranteed-slow-path framing).

**Polish (2 items)**:

5. **BullMQ global concurrency cap** (max 2-3 concurrent fetches) — low-and-slow is more ethical + more durable.
6. **Distinct 401 failure modes** — (a) first-request cookie expired, (b) mid-job expiry needing page-resume support (this one bundles a real feature), (c) every-attempt-401 meaning cookie name changed again.

**Recorded constraint (do NOT do)**: no Playwright/Puppeteer/IP rotation/CAPTCHA solving/anti-fingerprinting — shifts project posture from "exercising user rights" to "evading countermeasures," weaker ethically + more fragile.

**Full proposal**: [`docs/proposals/backlog/shapes-inc-fetcher-hardening.md`](docs/proposals/backlog/shapes-inc-fetcher-hardening.md).

**Sequencing**: queue after the cookie migration bake-in period — these items depend on the new cookie path being stable first (beta.103 shipped 2026-04-22; bake for at least one additional release cycle before starting).

Promoted from Inbox 2026-04-22.

### Theme: Security Audit Pass (discovery mini-epic)

_Focus: Systematic review of what a hostile user could do to harm the app. Output is a list of concrete per-finding backlog items grouped by severity, not a single PR._

**Scope**:

- (a) **api-gateway public / unauth endpoints** (image proxy, any media CDN routes, health checks, anything without `requireUserAuth` / `requireProvisionedUser`) — rate limits, resource consumption bounds, input validation.
- (b) **Endpoint authz escalation** — any route where `req.userId` / `req.provisionedUserId` could be spoofed upstream or where crafted params let a user access another user's data (persona IDs, character IDs, memory IDs, preset IDs across isolation boundaries).
- (c) **DDoS / DoS amplification** — expensive operations a single request can trigger (embedding generation, large AI context pulls, transcription jobs, TTS synthesis, multi-chunk voice), lack of per-user rate limits on paid-by-us LLM/TTS/STT calls, unbounded `findMany` queries still lurking after the 03-database.md sweep.
- (d) **Webhook / bot-client surface** — what a malicious Discord user could craft via slash-command args, message content, or voice attachments to exhaust resources (huge attachments, recursive references, adversarial reasoning-tag payloads).
- (e) **Secret leakage paths** — logs, error messages, PR bodies, commit history, git blame on removed env-handling code.

**Fix shape (meta-task output)**: one Inbox entry per finding, grouped by severity (critical / high / medium / low).

**Suggested structure**:

1. Run `/security-review` skill on the current branch as a first pass — covers the OWASP-ish code-level findings.
2. `pnpm ops xray --summary` on api-gateway + bot-client to enumerate public/unauth endpoints and walk each against categories a-d.
3. Output: concrete backlog items per finding.

**Start**: `pnpm depcruise` + `pnpm ops xray --summary` for the surface map; `services/api-gateway/src/routes/` for endpoint enumeration; `grep -r 'requireUserAuth\|requireProvisionedUser' services/api-gateway/src/routes/` to find the auth boundary. Promoted from Inbox 2026-04-22.

### Theme: BACKLOG.md Structure Redesign

_Focus: file-system-native navigable backlog structure that scales with idea volume instead of fighting it._

Single-file backlog has outgrown the format. Current size is ~48k tokens / ~1100 lines; sections span from 🚨 Production Issues through 🧊 Icebox + ⏸️ Deferred + References, and individual Inbox entries routinely exceed 20 lines. Navigation via `grep` + line-number jumps works but breaks down for higher-level views ("what's in flight?", "what's blocked on what?").

**User-stated reason**: there are a LOT of good ideas in flight and no matter how much the "shrink the backlog" feedback gets applied, the backlog keeps growing — because the idea throughput is genuinely high, not because of bloat. That's a feature, not a bug. We need a file structure that scales with idea volume instead of fighting it.

**Non-goal**: reinventing Jira. No ticket numbering, no statuses beyond what we already have, no workflow engine. Aim is file-system-native navigability.

**Design questions for council**:

- (a) Split by section type (e.g., `backlog/inbox/*.md`, `backlog/icebox/*.md`, `backlog/active-epic/*.md`) vs split by domain/area (e.g., `backlog/bot-client/`, `backlog/ai-worker/`)?
- (b) One-file-per-item vs grouped-by-theme files?
- (c) Does `CURRENT.md` get a similar treatment, or does it stay as a session tracker rooted at the top level?
- (d) How to preserve the "Production Issues → Current Focus → Quick Wins → Active Epic → Future Themes → Icebox → Deferred" topology when items live in separate files?
- (e) Mechanical enforcement: tooling to prevent drift (e.g., `pnpm ops backlog:index` that rebuilds a top-level index; structure tests that fail if an item lacks required frontmatter).

**Start**: consult `tzurot-council-mcp` skill with Gemini 3.1 Pro Preview on the design-questions list; draft a proposal in `docs/proposals/backlog/`; pilot on one section (Icebox likely — least active) before migrating the whole thing. Promoted from Inbox 2026-04-22.

### Theme: Preset Cascade Standardization (multi-PR epic)

_Focus: cross-tier preset-editing UX parity with the config-override cascade. Surfaced 2026-04-20 during Kimi-K2.5-routing bug triage (PR #853)._

The preset cascade (`LlmConfigResolver.resolveConfig`) has user-tier commands (`/settings preset default`, `/settings preset set <personality>`, `/settings preset clear-default`) but **no character-tier UX** for a personality creator to pin their character to a specific preset. Historically "filled" by the auto-pin bug PR #853 removed. Now personalities correctly cascade to current global default, but creators have no opt-in pin path.

**Contrast with the config-override cascade** (sampling, memory, reasoning, vision): has dashboards at **every tier** — `/settings defaults edit`, `/channel settings`, `/channel context`, per-personality override via `user_personality_configs.configOverrides`. Preset commands are flat args at user tier only. The asymmetry is probably why auto-pin slipped through — preset stopped at user-tier because "character tier is set at creation, done."

**Fix shape (multi-PR epic)**:

1. Add character-tier preset editing: new `/character edit` dashboard section for "Default preset" (read from `personality_default_configs`, write via new API endpoint). Creator/owner only. Opt-in — absent row → cascade to global default.
2. Standardize cascade UX: audit preset, config-overrides, and context settings for a common pattern — probably dashboard-per-tier with pin/inherit/clear semantics at each level. Document the canonical pattern in `.claude/rules/` so future settings cascades follow it.
3. Consider whether current resolver priority (`user-per-personality → user-default → personality-default → global-default`) is right, or whether users expect `user-default` to supersede `personality-default`. Council consultation 2026-04-20 flagged this as a genuine design question, not a bug.
4. Shapes import currently writes its own `personality_default_configs` upsert with the shapes.inc-specified model — preserve this as the "deliberate pin" path. Might need UX to explain "this was set by shapes import, not by you" in the edit dashboard.

**Also folds in** (moved from Inbox during 2026-04-21 triage):

- Post-`/character create` dashboard missing Delete button — two entry points produce different dashboards. Unify via dashboard factory.
- `/persona create` UX should mirror `/character create` (plus edit-in-place) — specific case of broader cascade-UX-inconsistency problem.
- Bot-owner/admin should be able to delete any preset — admin override capability for moderation/maintenance. Extend `services/api-gateway/src/routes/admin/llm-config.ts` to allow deleting any LlmConfig regardless of owner.
- Add Create button inside `/X browse` view for convenience — streamline "add one more" loop across browse-capable commands.

**Start**: `packages/common-types/src/services/LlmConfigResolver.ts:141` (cascade logic); `services/bot-client/src/commands/settings/preset/` (user-tier template); `services/bot-client/src/commands/character/dashboardButtons.ts` (add section); `services/ai-worker/src/jobs/ShapesImportHelpers.ts:41` (shapes pin path to preserve).

### Theme: `/character chat` in DMs — protocol-agnostic PersonalityChatManager extract

_Focus: `/character chat` slash command currently hard-errors in DMs because its render path uses webhooks (guild-only). Council-blessed Option D: extract domain logic so both message-handler AND slash-command entry points share one manager._

**Current gap**: typing `/character chat personality:Foo` in a DM produces "This command can only be used in text channels or threads." Regular `@CharacterName hello` in DMs works fine via `DMSessionProcessor` + `PersonalityMessageHandler`.

**Council rejected the obvious DRY shortcut**: do NOT synthesize a fake `Message` from an `Interaction` to reuse `handleMessage`. Known footgun — `discord.js` `Message` and `Interaction` back onto different Discord APIs (`message.reply()` vs `interaction.followUp()`, no `message.reference`/`mentions` on interactions, different typing-indicator semantics). Faking it is effectively shipping a `discord.js` mock in production code.

**Fix shape (Option D, council-blessed)**: extract domain logic out of `PersonalityMessageHandler.handleMessage` into a new `services/character/PersonalityChatManager.ts` accepting protocol-agnostic `ChatGenerationRequest { userId, channelId, isNsfwChannel, personalityId, userPrompt, authorDisplayName }`, returning the response payload. Both entry points parse their own Discord objects, call the manager, then handle delivery in their native protocol (plain reply for messages/DMs; webhook for guild slash commands; `interaction.followUp` for DM slash commands).

**Benefits**: no duplicated context building, no hacky fakes, future-proofs a hypothetical web-dashboard / API entry point.

**Risk**: touches a hot path shared by multiple processors — needs integration test coverage across DMSessionProcessor, BotMentionProcessor, and the slash command before the refactor lands.

**Also ship alongside**: belt-and-suspenders runtime message — if the DM branch of `/character chat` ever hits an unsupported state, reply with `In DMs you can also just type @CharacterName hello — no slash command needed.` instead of a bare technical error.

**Start**: `services/bot-client/src/services/PersonalityMessageHandler.ts` (source of logic to extract); `services/bot-client/src/commands/character/chat.ts:425` (site of webhook-only hard gate); `services/bot-client/src/processors/DMSessionProcessor.ts` (second caller of handleMessage that must keep working). Council consultation 2026-04-20 (Gemini 3.1 Pro Preview).

### Theme: Schema Audit for Nullable-That-Isn't FK Columns

_Focus: find other schema concessions like the Phase 5b `default_persona_id` nullability that was a code-convention workaround, not a real application state._

Phase 5b's NOT NULL fix revealed a pattern: `users.default_persona_id` was nullable at the DB level not because `null` was a meaningful application state, but because one code path (`getOrCreateUserShell`) was inconvenient to fix properly. Similar concessions likely exist elsewhere — this epic has found three load-bearing workaround patterns (`discord:XXXX` dual-tier, shell-user, null `default_persona_id`) in ~6 months of v3 development, suggesting more are hiding.

**Audit recipe**: (a) grep `prisma/schema.prisma` for `?` (optional) on FK columns and columns that are "always set" in application logic — for each, ask "can this actually be null in production, or is the app enforcing non-null via convention?"; (b) grep for default-value-that-never-applies patterns (columns with `@default` that callers always override); (c) grep Prisma `findUnique` / `findFirst` callers for `?.fieldName ?? fallback` patterns where `fallback` is never actually used in production; (d) grep for wide union types in TypeScript (`string | null`, `string | undefined`, domain enums widened to `string`) that the app narrows at runtime.

**Why it matters**: every schema concession is a place where a future refactor can silently re-introduce a bug class — the 5b class was the persona-snowflake bug that shipped undetected for 4 months.

**Why out of scope of Identity Epic**: audit doesn't have a single unifying theme — it's a discovery pass that will spawn multiple independent fix PRs. Best done as its own mini-epic after Phase 6 integration tests land (so we can lean on those tests when tightening invariants).

**Start**: `prisma/schema.prisma` — enumerate every `?` on non-timestamp columns, cross-reference with `.findUnique` usage sites to identify which nullable values are never null at rest.

### Theme: Enforce "Human Users Only" at Auth Middleware

_Focus: middleware-level invariant that rejects bot-user HTTP requests, moving the guarantee from code convention to structural enforcement._

PR #807 removed the 400-for-bot branch from api-gateway HTTP routes (NSFW verify, timezone, wallet, config-overrides, shapes auth/import/export, model-override, personality-config-overrides, llm-config) on the rationale that "HTTP routes aren't bot-accessible in practice — bots don't authenticate via session/discordId." That assumption holds today because Discord OAuth → session cookie only issues sessions to real Discord users.

**Risk**: if a future auth mode ever allows bot accounts (service-to-service JWT for third-party integrations, machine-user API keys, OAuth app-installation flow, etc.), the bot-user path is gone from all those routes and would silently provision shell users for bot Discord IDs.

**Fix shape**: add an `isBotUser` check to `requireUserAuth` middleware in `services/api-gateway/src/services/AuthMiddleware.ts` that rejects session subjects marked as bots before any route handler runs. Moves the guarantee from "code convention" to "middleware invariant" — route handlers no longer need to care about the distinction. Cost: one check per request, applied uniformly.

**Surfaced by**: PR #812 release reviewer observation F.

**Start**: `services/api-gateway/src/services/AuthMiddleware.ts`; check how session data encodes bot status (likely not at all yet since current Discord OAuth doesn't issue sessions to bots — may need to add that field); add rejection test case.

### Theme: Railway Log Search DX for Incident Digs

_Focus: close the observability gap for cross-service correlation during prod incident investigation._

When investigating specific production issues, the current Railway log surface is painful to search — no easy way to filter by request ID across services, correlate a user-visible symptom with a specific worker job, or scope to a tight time window around a known bad event. Most digs end with "I scrolled through the log stream hoping I'd spot the right line."

**Investigation (2026-04-13)** — the tooling gap is smaller than initially thought:

- **Railway CLI 4.11.2 supports server-side `--filter` with full query syntax** — not just substring matching. Plain text search (`"error message"`), attribute filters (`@level:error`, `@level:warn`), boolean operators (`AND`, `OR`, `-` for NOT), combinations. Docs: https://docs.railway.com/guides/logs. Powerful server-side query engine already available.
- **`pnpm ops logs --filter` is NOT using it**. `packages/tooling/src/deployment/logs.ts:44-68` does client-side substring grep in JS after fetching unfiltered logs via `railway logs -n <lines>`. The wrapper's `--filter` string never reaches the Railway args array. That's why the wrapper feels less capable — because it IS.
- **Correlation-ID threading is still a real gap**: bot-client logs reliably include both `requestId` and `jobId`. But api-gateway and ai-worker often log only `jobId`. Even with full `--filter` support, `railway logs --filter "requestId:X"` finds bot-client lines but fails to stitch them to worker processing — exactly the layer where most incidents unfold.
- **Log-forwarding (Axiom/Loki/Datadog)**: recurring cost, not justified for current incident rate.

**Remaining work**:

1. **Thread `requestId` into BullMQ job data** so ai-worker handlers log it alongside `jobId` (~2 hrs). Blocks cross-service correlation with any query tool. Start in `common-types/src/types/queue-types.ts`, propagate to api-gateway submit sites and ai-worker job handlers.
2. **Document the query syntax** in `RAILWAY_CLI_REFERENCE.md` (~30 min); update `tzurot-deployment` skill's log-analysis section to use `--filter` patterns instead of `| grep` (~15 min).
3. **Optional**: add explicit `--request-id` / `--job-id` / `--since` ergonomic flags to `pnpm ops logs` that translate to Railway query syntax (`@requestId:X`) (~2-3 hrs, only valuable after step 1).

### Theme: Package Extraction

_Focus: Reduce common-types export bloat and split bot-client, the largest package. Demoted from Next Epic 2026-04-15 when Identity Hardening promoted; resume after CPD Clone Reduction completes._

**Codebase snapshot (2026-02-12)**: 108K hand-written production LOC + 45K Prisma-generated.

| Package      | Files | LOC | Exports | Status                                                                              |
| ------------ | ----- | --- | ------- | ----------------------------------------------------------------------------------- |
| bot-client   | 254   | 46K | 767     | **Outlier** — nearly half the codebase, primary extraction target                   |
| ai-worker    | 105   | 19K | —       | Healthy                                                                             |
| api-gateway  | 104   | 17K | —       | Healthy                                                                             |
| common-types | 99    | 16K | 607     | LOC is fine (45K "bloat" was Prisma-generated); **607 exports** is the real problem |
| tooling      | 61    | 9K  | —       | Fine                                                                                |

#### Phase 1: Assessment

- [ ] Reassess common-types export count — categorize exports by domain to identify extraction boundaries
- [ ] Profile bot-client's 46K lines — which subdirectories are self-contained?
- [ ] Reference: PR #558 analysis

#### Phase 2: Extraction

- [ ] Candidates: `@tzurot/discord-dashboard` (30 files, self-contained), `@tzurot/message-references` (12 files), `@tzurot/discord-command-context` (6 files)
- [ ] Re-evaluate whether common-types needs splitting or just export pruning

**Previous work**: Architecture Health epic (PRs #593–#597) completed dead code purge, oversized file splits, 400-line max-lines limit, and circular dependency resolution (54→25, all remaining are generated Prisma code).

---

### Theme: Memory System Overhaul

_Dependency chain: Configuration Consolidation → LTM Summarization → Table Migration → OpenMemory_

#### 1. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns

#### 2. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

#### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage.

- [ ] Design waypoint graph schema
- [ ] Migration path from current flat memories
- [ ] See `docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md`

#### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

#### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

#### ✨ Cross-channel history — smarter retrieval with limits

Limit messages per channel, prioritize channels with active conversations. Distinct from the user-driven `/history range` import (tracked in Inbox) — this one is about the automatic retrieval path that assembles context at generation time.

---

### Theme: Character Portability

_Import and export characters and user data. Users own their data._

#### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/persona export` command - download all user data as JSON/ZIP
- [ ] Include: personas, presets, LLM configs, memories, conversation history
- [ ] Include: user settings, timezone, API keys (masked)
- [ ] Consider: character cards (PNG with embedded metadata) for personalities
- [ ] Privacy: only export data the user owns or has created

**Existing partial implementations**: `/preset export`, `/character export`

#### ✨ Character Card Import

Import V2/V3 character cards (PNG with embedded metadata). SillyTavern compatibility.

- [ ] Parse PNG metadata (V2 JSON in tEXt chunk, V3 in separate format)
- [ ] Map character card fields to v3 personality schema
- [ ] `/character import` support for PNG files

#### ✨ Shapes.inc Import

Phases 1-4 shipped (PRs #593-#662): schema, data fetcher, import pipeline, `/shapes` commands. Remaining backlogged phases:

- [ ] Phase 5: Sidecar prompt injection (depends on "User System Prompts" feature)
- [ ] Phase 6: Voice/image field import (voice tracked in Voice Engine Phase 5; image deferred)
- [ ] Phase 7: Training data import (needs training data schema first)
- [ ] Phase 8: Resolve memory sender UUIDs to display names via shapes.inc API
- [ ] Phase 9: Configurable export sections (`include_config`, `include_memories`, etc.)

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts (Sidecar Prompts)

Per-user text injected into the system message, shaping how characters interact with that specific user. Shapes.inc calls this "user personalization" — a freeform backstory (~3KB) the user writes about themselves per character. During shapes.inc import, this data is preserved in `customFields.sidecarPrompt` JSONB.

- [ ] Add `sidecarPrompt` field to `UserPersonalityConfig` (per-user-per-character) or `User` (global)
- [ ] Prompt assembly: inject sidecar text into system message (after character profile, before conversation)
- [ ] `/persona` dashboard upgrade to edit sidecar prompt
- [ ] Migration: move shapes.inc imported `customFields.sidecarPrompt` to proper field

#### ✨ Channel Allowlist/Denylist

Prevents bot from spamming unwanted channels, reduces server kicks.

- [ ] Add `mode` (allowlist/denylist) and `channels` array to ChannelSettings
- [ ] `/channel restrict` command for server admins
- [ ] Middleware check in message handler
- [ ] Consider "Ghost Mode" - bot listens but only replies when pinged

#### ✨ Multi-Character Invocation Per Message

Support tagging multiple characters in one message, each responding in order.

**Example**: `@character1 @character2 hello both` → both respond sequentially

- [ ] Modify mention extraction to return array of all valid mentions
- [ ] Combine reply target + mentions into ordered list (reply first, then mentions L→R)
- [ ] Add max limit (3-4 characters per message) to prevent abuse

#### ✨ Emoji Reaction Actions

Allow emoji reactions to trigger personality actions.

- [ ] Define action mapping (❤️ = positive feedback, 👎 = regenerate, etc.)
- [ ] Hook into reaction events (reactionAdd handler)
- [ ] Action dispatch based on emoji → action mapping

#### ✨ Denylist Duration Support

Allow `/deny` entries to have an optional expiration for temporary bans (e.g., `duration:24h`). Requires `expiresAt` column, filter check, and BullMQ cleanup job.

#### ✨ Transcript Spoiler Word List

Admin-managed list of words to auto-spoiler in voice transcripts (`||word||`). Add `spoilerWords` string array to `AdminSettings` JSONB with case-insensitive word-boundary matching.

#### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context. Extract emoji URLs from `<:name:id>` format, sticker URLs from message stickers, include alongside attachments.

---

### Theme: Model Configuration Overhaul

_Redesign how models are configured. Bundle paid/free/vision into reusable profiles._

#### ✨ Config cascade extension — server, user-server, user-channel tiers

Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers:

- **Server-level defaults** (server admins can set channel-scoped-to-guild defaults)
- **User-channel** (per-user per-channel, e.g., "1 week maxAge globally but off in #general")

User-default overriding channel is by design but limits power-user flexibility. Significant refactor — likely bundled with LLM Config Profiles since both change cascade shape.

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle paid + free models together, so the system can auto-fallback and users pick a profile rather than individual models.

**Core concept**: A profile is a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") that holds:

- Paid model config (model, temperature, max tokens, etc.)
- Free model config (fallback when quota/billing isn't available)
- Vision model config (bundled in — changing the global vision model should be one action, not per-LlmConfig)

**Cascade integration**: Profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override. Vision model inherits from the profile by default but users can override at any tier.

**User-facing**:

- Admin creates global profiles (themed defaults everyone can use)
- Users can create their own profiles (global/non-global, like personalities)
- `/preset` system may merge into or coexist with this

**Open questions**:

- Relationship to existing `Preset` system — replace, merge, or layer on top?
- How many vision profile themes are actually needed? (general, NSFW, document — or just general + NSFW)
- Character-level free model default (does it exist today? needs investigation)

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

#### 🏗️ Vision Model as Full LLM Config

Currently vision model is just a model name string. Promote to a full `LlmConfig` reference (temperature, max tokens, system prompt, etc.) — but exclude the `visionModel` field itself (no recursive vision config). Likely folded into profiles above.

---

### Theme: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors._

- **Agentic Scaffolding** - Think → Act → Observe loop
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images._

- **Image Generation** - AI-generated images from personalities

---

### Theme: Voice Engine

_Focus: Two-tier voice system (self-hosted free + ElevenLabs BYOK premium) for both STT and TTS._

**Status**: Phases 1–4.6 shipped. Free tier (Parakeet TDT + Pocket TTS) in v3.0.0-beta.89. ElevenLabs BYOK (Phase 4) in PR #727. Configurable TTS model + cleanup (Phase 4.6) in PR #729. Dev-testing fixes (scoped-key detection, voice auto-reclone, STT userId) in v3.0.0-beta.90.

| Tier               | STT                         | TTS               |
| ------------------ | --------------------------- | ----------------- |
| Free (self-hosted) | NVIDIA Parakeet TDT 0.6B v3 | Kyutai Pocket TTS |
| Premium (BYOK)     | ElevenLabs Scribe v2        | ElevenLabs v3     |

#### Phases 1-4.6 (COMPLETE)

All shipped across beta.89-90 + PRs #710, #727, #729, #731-733. Key milestones:

- **Phase 1**: Python FastAPI voice-engine service (Parakeet TDT STT + Pocket TTS), Railway Serverless
- **Phase 2**: ai-worker VoiceEngineClient integration, replaced Whisper STT
- **Phase 3/3b**: TTS pipeline (TTSStep, chunked synthesis, Redis audio storage), `/character voice` command, config cascade wiring
- **Phase 4/4.5**: ElevenLabs BYOK (TTS, STT, voice cloning, slot management), Whisper removal
- **Phase 4.6**: Configurable TTS model (`/settings voices model`), CPD cleanup (152→146)

See git history for detailed task lists.

#### Phase 5: Shapes.inc Voice Field Import

Import voice configuration from shapes.inc character data.

- [ ] Map shapes.inc `voice_model`, `voice_id`, `voice_stability` fields to Tzurot voice config
- [ ] Set `voiceEnabled: true` for imported characters with voice data
- [ ] Create voice states from imported reference audio if available

**Research**: `docs/research/voice-cloning-2026.md`

#### 🐛 Voice Pipeline Resilience (Cold Start + Timeout Architecture)

Intermittent failures from Railway Serverless cold starts (~56s). Significant progress made in beta.92 and beta.93 work:

**Completed:**

- [x] STT bot-client timeout (`AbortSignal.timeout(120s)`) — PR #757
- [x] Adaptive TTS timeout (150s ElevenLabs, 240s voice-engine) — PR #757
- [x] Warmup polling returns `{ ready, elapsedMs }` for observability — PR #757
- [x] Timeout-aware user error messages — PR #757
- [x] ECONNREFUSED retry resilience for both TTS and STT — PR #759

**Remaining:**

- [ ] Parallel TTS chunking — synthesize chunks concurrently instead of sequentially (long messages still bottleneck)
- [ ] Better user feedback during STT wait — "Transcription in progress..." → "Taking longer than expected..." → error
- [ ] Transcription retry outcome surfacing — user sees generic error, not retry status

---

### Theme: Typing Indicator Reliability

_Focus: diagnose and fix intermittent typing-indicator dropouts during long AI responses. Quick Win "error differentiation" step is the prerequisite and ships first; this theme covers everything after._

**Observed**: user has seen the "bot is typing…" indicator disappearing before the AI response actually lands, multiple times, not yet reproduced deterministically. Unclear whether this is a bot-side bug (failed `sendTyping` refresh not recovering) or a Discord client-side display glitch.

**Current implementation — two independent typing loops**:

- `services/bot-client/src/services/JobTracker.ts:85-149` — fires `channel.sendTyping()` every 8s until the 10-min cutoff or job completion. Errors swallowed at lines 144-146.
- `services/bot-client/src/services/VoiceTranscriptionService.ts:186-198` — independent interval at the same cadence for voice flows, also swallowing errors.

**Hypotheses (ranked by likelihood)**:

1. **Rate limiting on `sendTyping`** — Discord rate-limits `POST /channels/{id}/typing` per-channel. Concurrent @mentions in the same channel can double the effective rate. Current catch treats 429s identically to other errors — no backoff. **Check after step 1 (Quick Win) ships**: log-search for 429 classifications grouped by channel and 5-min windows.
2. **Handoff gap between VoiceTranscriptionService and JobTracker** — for voice flows, VoiceTranscription's interval terminates when transcription finishes; JobTracker starts after. If the gap is >2s, the Discord indicator flickers off (Discord typing TTL is ~10s; we refresh at 8s, only 2s buffer). **Check**: instrument the transition with a timestamped log pair.
3. **Gateway disconnect/reconnect during long jobs** — `typingInterval` keeps firing in-process but REST calls may fail silently or queue. Correlate typing dropouts with `Client#disconnect`/`Client#resume` events.
4. **Discord client-side rendering bug** — anecdotal, known to happen on mobile / intermittent connections. Not fixable bot-side; only relevant to rule out.
5. **Abuse-prevention heuristics** — anecdotal reports of Discord suppressing typing indicators that have been running continuously "for a long time." No official documentation. Check: does dropout correlate with job age?
6. **discord.js bug/regression** — check v14.26.2 release notes for typing-related changes.

**Investigation steps (after Quick Win step 1 ships)**:

2. **Per-channel aggregation telemetry** — count of `sendTyping` calls and failures per channel per 5-min window. Surfaces rate-limit patterns.
3. **Voice-handoff gap measurement** — instrument the VoiceTranscriptionService → JobTracker transition. If gap >2s on reproducer cases, this is the voice-specific failure mode.
4. **User-side repro capture** — when user notices next dropout, record channel / time (UTC) / voice-or-text / long-or-short reply / client (desktop/web/mobile). Cross-reference with differentiated logs.

**Remediation options (pick after findings)**:

- **If rate-limiting**: coalesce typing loops per-channel (one loop per channel regardless of concurrent jobs), or back off on 429 instead of retrying at fixed cadence. Reducing refresh 8s → 7s widens buffer but also increases rate.
- **If voice-handoff gap**: continue the first typing loop across the handoff rather than restarting fresh.
- **If gateway reconnect**: subscribe to `Client#resume` and re-fire typing for all tracked jobs on reconnect.
- **If Discord client bug**: document and close.

**Why this matters despite being "small" UX**: the typing indicator is the sole signal a user has that the bot received their message. Dropouts → users assume "bot is broken" → they retry → duplicate requests → more load → more rate limits → more dropouts. The loop gets worse under load, not self-healing.

**Start**: Quick Win "Differentiate typing-indicator error types" ships first. That entry is the prerequisite — its differentiated logs drive every step here. Surfaced 2026-04-22.

#### Sub-item: Route `VoiceTranscriptionService` initial `sendTyping` through the classifier

Surfaced 2026-04-24 by PR #886 review. `JobTracker` wraps both the interval-loop and the initial-send `channel.sendTyping()` in `handleTypingError`. `VoiceTranscriptionService.transcribe` routes only the interval-loop; the initial `await channel.sendTyping()` at line 188 propagates a channel-unreachable error up to the outer `try/catch`, which fails the whole transcription with a generic catch-all reply instead of the classifier's differentiated "channel unreachable" log + graceful return. Fix: wrap the initial send in try/catch or route through `handleTypingError` like JobTracker does, and decide whether channel-unreachable should abort transcription or proceed without the typing indicator. **Start**: `services/bot-client/src/services/VoiceTranscriptionService.ts:188`.

#### Sub-item: Respect `retryAfterSeconds` in the typing-indicator backoff

Surfaced 2026-04-24 by PR #886 review. When Discord rate-limits `sendTyping` with a 429, the classifier warns and returns but the interval keeps firing at its normal 8s cadence. If `retryAfterSeconds > TYPING_INDICATOR_INTERVAL_MS / 1000` (1.5s at current settings but the typing refresh is 8s — meaning retryAfter > 8s in practice), every subsequent tick inside the backoff window also gets rate-limited, generating a warn log every 8s until the window clears. Under sustained rate-limiting this produces a noisy burst of warn entries in Railway logs and wastes API calls we know will fail. **Fix shape**: when `handleTypingError` returns `rate-limit` with a `retryAfterSeconds`, pause the interval for at least that duration — either `clearInterval` + `setTimeout` to re-arm, or track a `pausedUntil: number` timestamp in the tracker and have each interval tick check it before calling sendTyping. **Not urgent**: current classifier is already a substantial improvement; the noisy-log case requires a real sustained-429 event to surface.

---

### Theme: Logging & Error Observability

_Comprehensive audit of logging quality, error serialization, and log hygiene across the stack._

#### 🐛 Lie-on-Error Fallback Audit (api-gateway category sweep)

Pattern surfaced by PR #881: the old `GET /user/timezone` handler returned `{ timezone: 'UTC', isDefault: true }` when the user row didn't exist. Phase 5c correctly replaced it with a 404 since `requireProvisionedUser` guarantees the row exists in happy flow. Architecturally correct but points at a broader category — endpoints that silently degrade to defaults on state errors mask real bugs in prod.

**Audit scope**: grep api-gateway for `|| 'default'`, `?? defaults`, `if (user === null) return success-with-fallback` patterns. Any endpoint returning a "plausible but fake" success where the real answer is "this doesn't exist / isn't available" is a candidate.

**Fix shape per site**: flip to proper error response (404 / 400 / 409) and surface the "fake success" path in logs so downstream consumers (bot-client graceful-degradation logic) can adapt. Each flip is a small contract change — cheap individually but the category-wide sweep is multi-site.

**Why a theme, not a Quick Win**: the timezone case was one documented instance; the audit may surface 3-10+ more across routes, each needing its own small fix + release-note entry. Coordinate as one audit pass rather than drip-fed one-off fixes.

**Start**: `services/api-gateway/src/routes/user/**` first (most user-facing state-lookup endpoints live there); then admin, shapes, persona routes. Surfaced by claude-bot review on PR #881 round 3 (2026-04-23).

#### 🐛 Error Serialization Audit

During the GLM-5 empty response investigation, `err` serialized as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`. Makes logs nearly useless for debugging provider issues.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Audit Node `undici` fetch errors — `TypeError` from `fetch()` serializes as `raw: "{}"` in Pino (non-enumerable properties). Seen in `GatewayClient.submitJob()` and `PersonalityMessageHandler` on Railway dev (2026-02-15)
- [ ] Review `normalizeErrorForLogging()` in `retry.ts` wrapping behavior
- [ ] Review `determineErrorType()` in `logger.ts` checking `constructor.name`
- [ ] Codebase-wide scan for `{ err: ... }` patterns that produce useless output
- [ ] Goal: every `{ err: ... }` log shows message + stack, never `raw: "{}"`

#### 🐛 Inadequate LLM Response Detection

Compound scoring heuristic to detect garbage 200 OK responses (e.g., glm-5 returned just `"N"`, 1 token, `finishReason: "unknown"`, 160s). All signals already collected by `DiagnosticCollector` but timing data needs threading through `RAGResponse`. Integrates into PR #702's retry loop via `FallbackResponse` ranking.

**Signals**: `finishReason` unknown/error (+0.4), `completionTokens` ≤1/≤5 (+0.3/+0.15), no stop sequence + short (+0.2), extreme ms-per-token (+0.2), empty content (+0.3). Threshold: ≥0.5. Max 1 content retry.

**Files**: `ConversationalRAGTypes.ts` (add timing field), `ConversationalRAGService.ts` (thread timing), `RetryDecisionHelper.ts` or new scorer, `GenerationStep.ts` (call scorer), tests.

**Reference**: `debug/debug-compact-736e6c99-*.json`

#### 🏗️ Per-Attempt Diagnostic Tracking in Retry Loop

When the fallback response path is used (PR #672), the diagnostic payload has data from attempt 1 (token counts, model, raw content) but `llmInvocationMs: undefined` because timing was reset for attempt 2 which failed. Add a `diagnosticAttempt` field or per-attempt timing array so the payload is internally consistent about which attempt's data it contains.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG. Noisy logs obscure real issues in production.

- [ ] Audit all `logger.info()` calls — demote routine operations to DEBUG
- [ ] Ensure ERROR/WARN are reserved for actionable items
- [ ] Review hot paths (message processing, cache lookups) for excessive logging

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding in every log call.

- [ ] Extend Pino logger factory to auto-add service name prefix
- [ ] Remove manual `[ServiceName]` prefixes from log messages
- [ ] Consider structured `service` field instead of string prefix

#### 🏗️ Audit Error Sanitization in Log Pipeline

Two gaps: (1) Enumerable Error properties (e.g. Axios `error.config.url`) bypass `sanitizeObject()` early-return for `instanceof Error`. (2) `getErrorContext` callback results spread into log objects without sanitization. Check OpenRouter/LangChain error objects, document API contract. Discovered during PR #700.

#### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped), this is the remaining differentiation.

- [ ] Admin error responses include stack traces and internal context
- [ ] User-facing errors show friendly messages without internals

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [ ] **CPD**: Currently non-blocking in pre-push. Once under target (<100 clones), add threshold check that blocks push
- [ ] **Duplicate Exports**: `guard:duplicate-exports` runs in CI with `continue-on-error: true`. Add ratchet (baseline count file + "new duplicates above baseline" check) so it blocks CI while still allowing existing allowlisted duplicates. Then drop `continue-on-error`
- [ ] **ESLint warnings**: `max-statements`, `complexity`, `max-lines-per-function` are warn-level. Audit current violation count, set a baseline, block new violations
- [ ] **Knip**: Dead code detection runs manually. Add to pre-push or CI as blocking check

Goal: every quality check that currently warns should eventually block, with a clear baseline so new violations are caught immediately.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Currently each job type has both a Zod schema and a hand-written TypeScript interface that must be kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Do the same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🏗️ Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate: dev-only auto-migration in start command, pre-deploy hook with `prisma migrate deploy`, CI step that validates migration state matches schema.

#### 🏗️ API Gateway Middleware Wiring Integration Tests

Add supertest-style integration tests that boot the actual Express app with real middleware. Verifies auth middleware is correctly applied (factory functions called, not just passed), routes respond properly, error middleware works. Audit `router.use(...)` calls for missing `()` on factory functions. Discovered during PR #691.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

### Theme: Observability & Analytics

_Codebase-wide decisions on retry counts, timeouts, cache TTLs, rate limits, and feature adoption currently rely on guesswork because we don't systematically capture the data needed to answer them. Vision-pipeline telemetry landed 2026-04-14 as the first concrete step; treat the rest as epic-sized work._

#### ✨ Observability & Telemetry Strategy

**Problem**: System-health decisions (retry counts, timeouts, cache TTLs, queue concurrency) are made without quantitative data. Same pattern exists throughout ai-worker, api-gateway, bot-client — vision-pipeline fix on 2026-04-14 was just the first concrete instance.

**Scope**:

- Audit current logging across all services, identify gap events (hot-path successes with `durationMs`, cache hit/miss rates, job durations, queue depths, retry success rates per category)
- Establish `{ durationMs, attempt, errorCategory, ...dimensionX }` structured-log conventions across the codebase (vision-pipeline retry logs are the prototype)
- Document Railway query cookbook (builds on `pnpm ops logs --filter` DSL passthrough)
- Define "decision-triggering metrics" — events that, when queried, answer a specific tuning question

**Non-goal**: standing up Prometheus/Datadog/OTel. Pino + structured logs + Railway server-side query DSL is likely sufficient at one-person-project scale.

#### ✨ User Analytics Strategy

**Problem**: No systematic view of product usage. Questions unanswerable today: which personalities have active users? Are users adopting `/browse` or falling back to `/list`? Does voice-engine adoption correlate with specific personalities? What's retention look like by user cohort?

**Scope**:

- Event taxonomy: command invocations, personality switches, voice/vision/memory usage, user-facing errors (as product signals, not debug signals)
- Privacy constraints: opaque user IDs only — never usernames, message content, or PII
- **Build-vs-buy decision** (first real decision point for this epic):
  - Off-the-shelf leading candidate: **PostHog self-hosted on Railway** (open-source, product-analytics-native, supports server-side event ingestion, self-hostable to avoid third-party data)
  - Lighter alternatives: Plausible (too web-page-centric for a Discord bot), custom Postgres event table + query UI (most control, heaviest ops burden)
- Integration surface: event emission as middleware/hooks in command handlers and job processors, decoupled from business logic

**Non-goal**: anything requiring message-content inspection (privacy non-starter).

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### Surfaced 2026-04-25 (beta.106 hotfix)

- 🌐 `[CHORE]` **Upstream LangChain PR — recognize `message.reasoning` in chat completions converter** — `@langchain/openai` v1.4.4's `converters/completions.js:160` extracts only `message.reasoning_content` (DeepSeek's legacy field name). OpenRouter, vLLM (post RFC #27755), and OpenAI's own GPT-OSS guidance all use `message.reasoning` (no `_content` suffix). Multiple open issues track this gap: [langchain #32981](https://github.com/langchain-ai/langchain/issues/32981) (OpenRouter→ChatOpenAI specifically), [#34706](https://github.com/langchain-ai/langchain/issues/34706), [#35901](https://github.com/langchain-ai/langchain/issues/35901). Submit a PR to `langchain-ai/langchainjs` adding `message.reasoning` (and `delta.reasoning` for streaming) recognition alongside the existing `reasoning_content` extraction. **Why iceboxed**: ecosystem fix with slow turnaround; once landed it would make our `OpenRouterFetch` interceptor's response-mutation logic redundant, but we have a faster local solution via `includeRawResponse: true` (in flight). **Start**: `services/ai-worker/node_modules/@langchain/openai/dist/converters/completions.js:160` for the upstream pattern to mirror; PR target `libs/providers/langchain-openai/src/converters/completions.ts` in [langchainjs](https://github.com/langchain-ai/langchainjs). Surfaced 2026-04-25 during reasoning-extraction investigation.

- 🛡️ `[LIFT]` **Custom undici Dispatcher with `connect.lookup` for true DNS-rebinding closure** — `safeExternalFetch.assertResolvedHostnameIsPublic` runs `dns.promises.lookup({ all: true })` and validates every returned IP is public. Closes the IPv4-public/IPv6-private family-mismatch bypass, but a TOCTOU window remains: between our lookup and undici's own resolution at fetch time, the DNS record could change. Mitigation: wrap fetches with a custom undici `Agent` whose `connect.lookup` runs the same validation (or pins the connection to the validated IP). **Why iceboxed**: requires custom Dispatcher implementation, not a hotfix-shape change. Forensic logging exists in beta.106 (`External URL hostname resolved to public IP(s)` at debug level — kept low-volume per round-2 review feedback; redeploy with `LOG_LEVEL=debug` to enable for incident triage) and would show whether real-world traffic indicates exploitation pressure — promote if we see suspicious rapid-DNS-swap patterns. Reference: [`request-filtering-agent`](https://github.com/azu/request-filtering-agent) does this for Node's HTTP client; needs adaptation for undici. Council recommendation 2026-04-25.

- 🛡️ `[LIFT]` **Loosen AudioProcessor SSRF allowlist if audio embeds need to work** — `services/ai-worker/src/services/multimodal/AudioProcessor.ts:56` keeps the strict Discord-CDN allowlist via `validateAttachmentUrl`. Audio embeds are nearly nonexistent in Discord UX (audio is almost always a direct attachment from `cdn.discordapp.com`), so the symmetric external-fetch fix that beta.106 applied to images was deliberately scoped out. Revisit when: (a) users report audio embeds failing to transcribe (Reddit/Imgur audio in extended context, forwarded audio attachments with non-CDN URLs), or (b) the same image/audio code path needs to converge for symmetry reasons. **Fix shape**: same two-tier validation pattern from `DownloadAttachmentsStep.routeAttachmentUrl` — try `validateAttachmentUrl` first, fall back to `validateExternalImageUrl` + a new `fetchExternalAudioBytes` (or generalize `fetchExternalImageBytes` with a content-type-prefix parameter). **Why iceboxed**: no current user complaints, additional surface area, council confirmed scope cut. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Pre-filter non-image embed URLs in `embedImageExtractor`** — Discord embeds carry a long-tail of non-image things (Tenor view-page URLs, Spotify/YouTube link cards, custom-emoji URLs, sticker references) that today flow through to ai-worker as "image attachments" and either fail validation or fetch text/HTML payloads (now caught by the Content-Type assertion in `safeExternalFetch`). A bot-client-side filter would reduce noise in ai-worker logs and avoid unnecessary external fetches. **Fix shape**: add an extension/path heuristic (`.png|.jpg|.jpeg|.gif|.webp|.bmp` or known image hosts) before pushing into the attachment list. **Why iceboxed**: the new external-fetch path now handles these gracefully (rejected via Content-Type assertion); this is a tidiness improvement, not a correctness fix. Surfaced 2026-04-25 during beta.106 hotfix audit.

- 🧹 `[CHORE]` **Typed `AllowlistRejectionError` for `validateAttachmentUrl`** — `DownloadAttachmentsStep.routeAttachmentUrl` matches the Discord-CDN allowlist failure by error-message substring (`message.includes('must be from Discord CDN')`). A typed error class would let the caller match by `instanceof` instead, which is more refactor-resilient. **Fix shape**: introduce `AllowlistRejectionError extends Error` in `attachmentFetch.ts`, throw it instead of `new Error(...)` when the host check fails, update the routing helper to match by class. **Why iceboxed**: the string match works today and is tested. Promote if the error message ever needs to change (e.g. localization, additional hosts in the message) or if a third validation tier appears. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Factor `validateUrlBaseSecurity` from validateAttachmentUrl + validateExternalImageUrl** — Both functions duplicate ~25 lines of surface checks (https only, no credentials, no non-standard ports, no IP-as-hostname, ReDoS-safe trailing-dot normalization). The duplication is intentional for the hotfix (low-risk, no refactor of the existing tested function), but a shared `validateUrlBaseSecurity` helper would prevent drift. **Fix shape**: extract the common checks into a helper that returns the parsed URL object; both validators compose it and add their distinct allowlist (or no-allowlist) logic on top. **Why iceboxed**: the duplication is small, both functions are tested independently, the refactor would touch hot SSRF code right after a production incident. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Per-step `errorInfo.type/shouldRetry` classification in `LLMGenerationHandler` catch** — Today's hotfix (PR #893) maps every non-DownloadAttachments step failure to `ApiErrorType.PERMANENT` + `shouldRetry: false`. Real-world step failures vary: `ConfigStep` and `AuthStep` can throw on transient DB/network issues that would benefit from `TRANSIENT`/`shouldRetry: true`; `NormalizationStep`/`DependencyStep`/`ContextStep` are usually permanent (data-derivation bugs). Today the practical user impact is minimal — the bot doesn't re-enqueue pipeline-step failures regardless of `shouldRetry`, so the misclassification is just slightly-misleading spoiler text. **Promote when**: a retry harness for non-Generation step failures gets wired (so `shouldRetry` actually drives behavior), OR users start reporting "PERMANENT" surfacing for what was clearly a transient hiccup. **Fix shape**: replace the binary `if (DownloadAttachments) … else …` with a Map<stepName, { category, type, shouldRetry }>. Surfaced 2026-04-25 by claude-bot review on PR #893 (medium severity).

### Surfaced 2026-04-24

- 🐛 `[FIX]` **GLM-family meta-preamble pattern drift** — GLM-4.5-Air and GLM-4.7 each shipped distinct preamble tag vocabularies (`<from_id>/<user>/<message>` for 4.5-Air, `<user>/<character>/<analysis>` for 4.7). Each revision needs its own extractor added to Pass 1 of `services/ai-worker/src/utils/thinkingExtraction.ts`. **Watch-item, not actionable yet**: when new GLM revisions deploy, monitor production logs for the existing `Stripped leading meta-preamble scaffolding` log lines NOT firing on reasoning-enabled responses where output looks structured. A new vocabulary will surface as unexplained user complaints ("why is my response starting with weird XML?") and absent log lines. Promotes to 🚨 Production Issues on first observed drift. Reference: PR #888 (GLM-4.7), PR #875 (GLM-4.5-Air), auto-memory `project_glm_47_quirks.md`. Surfaced 2026-04-24 by PR #888 review.

- 🐛 `[FIX]` **GLM-4.7 bare-`<analysis>` false-positive surface** — The `GLM_47_META_PREAMBLE_PATTERN` uses `{0,2}` on the preamble group, meaning it fires on a bare `<analysis>...</analysis>` block at the start of a response even with no `<user>`/`<character>` preamble. Intentional per observed production shape, but creates a false-positive surface: a personality explicitly instructed to begin responses with an `<analysis>` block (medical/research persona, structured-output format, diagnostic persona) would have its `<analysis>` content silently stripped from `visibleContent`. **Signal to watch for**: user reports of disappeared/truncated structured-output responses from personas with `<analysis>`-formatted instructions. **Mitigation on first observation**: tighten `{0,2}` → `{1,2}` in `thinkingExtraction.ts:~180`, removing the "handles bare `<analysis>` with no preamble tags" test case. Zero production evidence today of legitimate bare-`<analysis>` responses; also zero evidence of GLM-4.7 omitting _both_ preamble tags — so the tighten would cost nothing today but shrink the attack surface. Deferring until we see a real signal either direction. Reference: PR #888 round 4 review. Surfaced 2026-04-24.

- 🐛 `[FIX]` **Aggregate payload cap doesn't fire when any download fails (partial-failure observability gap)** — `DownloadAttachmentsStep.process` checks `allFailures.length > 0` before the aggregate-size check, so if any per-attachment download fails, the job throws a generic `Error('Failed to download...')` instead of `JobPayloadTooLargeError`. The job still fails correctly — it just doesn't surface the _additional_ fact that the surviving attachments would also have exceeded the 50 MiB aggregate cap. Minor observability gap: dashboards can't see "would have been too large anyway" as a separate failure signal. **Fix shape**: move the aggregate-size sum to a pre-flight check (sum the per-attachment `size` fields BEFORE downloading any bytes — Discord's API gives us sizes upfront in `AttachmentMetadata.size`), so the cap can fire as a classified pre-flight rejection independent of download success. **Why iceboxed**: today's failure mode is correct (job fails); this would only add diagnostic clarity. Promote if `JobPayloadTooLargeError` ever needs to drive a different retry policy than generic download failures, or if we add a UI surface that distinguishes "too large" from "couldn't fetch." Surfaced 2026-04-24 by PR #890 R4 claude-review.

- 🏗️ `[LIFT]` **Stronger structural guard: `sentinelSafe` field on typed-options schema** — Companion to PR #885 (autocomplete sentinel guards, shipped 2026-04-24). That PR protects all 19 known consumer sites with inline `isAutocompleteErrorSentinel(x)` early-returns. Works, but every new autocomplete-backed command is another place to forget the guard. The structural fix lives one layer down, in the typed-options accessor (`packages/common-types/src/utils/typedOptions.ts` + generated `packages/common-types/src/generated/commandOptions.ts`): add a `sentinelSafe: true` field on autocomplete-backed option schemas so the generated accessor itself throws a typed `AutocompleteSentinelError` when the sentinel is read. Each consumer then catches (or lets a top-level handler in `CommandHandler` catch) and renders the standard "Autocomplete was unavailable" reply — the guard becomes impossible to forget. **Why not bundled into PR #885**: would have expanded the quick-win scope into (a) generator changes for `commandOptions.ts`, (b) new error type + catch conventions, (c) removing the 19 inline guards in favor of the centralized one, (d) deciding how `CommandHandler` / modal-context handlers catch and reply. Each of those is its own design call. **Start**: `packages/common-types/src/utils/typedOptions.ts` (schema type + accessor switch); `packages/tooling/src/*/generate-command-types*` (wherever `commandOptions.ts` is generated from); `services/bot-client/src/CommandHandler.ts` for the catch-and-reply boundary. **Exit criterion**: all 19 inline sentinel guards from PR #885 deleted; adding a new autocomplete-backed command cannot silently skip the guard.

### Triaged from Inbox 2026-04-24

- 🏗️ `[LIFT]` **CI test-suite speed investigation** — CI runs spend ~4–5 minutes on the `test` step alone, and local pre-push hook runs ~4 minutes on Steam Deck (concurrency=1). The waiting cost compounds over every PR iteration and every Round-N review cycle. Investigate where the time actually goes before prescribing fixes. **Candidate areas, in priority order**: (1) Real-timer audits — grep `setTimeout|setInterval` in `*.test.ts` without nearby `vi.useFakeTimers()` or `vi.advanceTimers`. Observed 2026-04-24: `AudioProcessor.test.ts` has retry tests showing 3005ms / 3004ms duration lines (real 3s backoffs × several tests = ~12s pure wall-clock burn). Similar patterns likely elsewhere. (2) Test import cost — ai-worker suite's vitest stats showed 63s of `import` time on 2616 tests. Lazy-loading or narrower describes for heavyweight modules (Prisma, LangChain, sharp) could cut it materially. (3) CI concurrency — the pre-push hook sets `--concurrency=1` under `LOW_RESOURCE_MODE` for Steam Deck memory; if the GitHub Actions `test` step inherits the same flag, that leaves parallelism on the floor (runners have more memory than the Deck). **First step when picked up**: run `pnpm ops xray` or equivalent instrumentation to get per-file duration + import time, prioritize fixes by elapsed-seconds-saved-per-run. **Fix shape likely**: `DownloadAttachmentsStep.test.ts` pattern from PR #889 — injectable timing params default to prod values, tests pass `0` (dropped 540ms → 17ms there). Replicating across the ~5 slowest test files could meaningfully cut CI time. **Why iceboxed**: multi-step investigation+fix cycle (4-8 hours), no urgency today — CI passes, just slow. Promote when waiting on CI starts blocking iteration speed in a way the user notices session-to-session. Surfaced 2026-04-24.

### Triaged from Inbox 2026-04-22

_Second backlog-shrink pass. Same preservation principle — full prose retained._

- 🧹 `[CHORE]` **File OpenRouter issue for GLM-4.5-air fake-user-message reasoning leak** — Companion to PR #875 (shipped 2026-04-22). The Chain-of-Extractors post-processor is our fix, but OpenRouter's reasoning-middleware can polyfill this at the API layer so every consumer benefits. They actively polyfill similar quirks for DeepSeek/Qwen/Llama. **Payload**: attach raw API response from req `b533e288-fb07-46c0-a5e2-a0f78883e63e`, model string `z-ai/glm-4.5-air:free`, trigger `reasoning.enabled=true`. Note the pattern: model wraps CoT in `<from_id>UUID</from_id>\n<user>Name</user>\n<message>reasoning</message>` — structurally distinct from `<think>` but unambiguously a reasoning leak (UUID validation makes it safe to detect). **Exit criterion**: OpenRouter populates `message.reasoning` for this pattern → `GLM_FAKE_USER_MESSAGE_ECHO_PATTERN` and its test suite can be deleted. **Why iceboxed 2026-04-22**: user has not filed an upstream GitHub issue before; nervous about the first filing. Pickup path: either user gains comfort with the process, or a future session assistant drafts the issue text for review before submission (deliberately offered, user chose to defer entirely for now).

- 🐛 `[FIX]` **Character `Open Editor` can still blow the 3-second window on cold cache + slow gateway** — The two-click Edit-with-Truncation flow (PR #825 option b) materially narrowed but did not fully eliminate the 3-second risk. `handleOpenEditorButton` in `services/bot-client/src/commands/character/truncationWarning.ts` still calls `resolveCharacterSectionContext` before `interaction.showModal` — because Discord requires `showModal` to be the first response to an interaction, we can't `deferReply` before the resolve. In the common case the session is hot from step 1's warm and this is a sub-ms Redis hit. But a cold-cache fallthrough (Redis eviction, pod cold start, TTL past the step-1 warm window) routes through the gateway's `fetchCharacter`, which can take hundreds of ms to multi-seconds under load. When that blows the window, the handler's 10062 catch surfaces a visible retry message — not silent, but the user is already one click deep into a consent flow and the retry ask is confusing. Surfaced by PR #825 R8 (2026-04-17).

  **Why tracked now (low priority)**: the 10062 fallback is user-actionable (clicks "Open Editor" again, fresh 3-sec window, very likely succeeds on second try), so the bug is not silent. But the retry UX could be improved.

  **Fix options** (none urgent):
  - **(a)** Pre-resolve the full `CharacterSectionContext` during step 1's warm and stash it in an in-memory cache keyed by the `open_editor` button's customId. Step 2 retrieves synchronously, builds modal, `showModal` with zero async work. Works for single-replica bot-client; breaks on multi-replica unless the cache is Redis-backed (which reintroduces the async). Tzurot is currently single-replica for bot-client (Discord gateway requirement).
  - **(b)** Pre-build the modal (not just the context) during step 1 and stash the modal JSON. Same trade-offs as (a).
  - **(c)** Just raise the gateway timeout on `fetchCharacter` when called from the session-helpers path so the cold-cache fetch reliably fits in 3 sec. Smallest change but doesn't defend against the raw Redis latency spike.
  - Do nothing: the 10062 retry path is user-actionable. Accept the residual and rely on the warn log for frequency monitoring.

  **Start**: `services/bot-client/src/commands/character/truncationWarning.ts` `handleOpenEditorButton`; the 10062 catch immediately after `await interaction.showModal(modal)`; the step-1 warm origin in `handleEditTruncatedButton`; `services/bot-client/src/utils/dashboard/sessionHelpers.ts` `fetchOrCreateSession`. Demoted from Inbox 2026-04-22 — self-described low priority, user-actionable fallback exists.

- 🐛 `[FIX]` **Stale "Open Editor" button after step-1 session-warm failure in character truncation flow** — Sibling to the 3-sec residual entry above. When `handleEditTruncatedButton`'s session warm fails (character-deleted race between warning display and opt-in click), the handler already sent `interaction.update` with the "Ready to edit" embed + Open Editor button; `loadCharacterSectionData` then sent a followUp error; but the Open Editor button is still visible. If the user clicks it, `resolveCharacterSectionContext` fails again and sends a second redundant followUp. User sees two back-to-back "Character not found" messages with a stale button between them. Flagged by PR #825 R10 (2026-04-17).

  **Not a data-safety issue**: the second failure is just UX noise. The user can close the warning and re-open the dashboard; no data is lost or corrupted.

  **Fix options**:
  - **(a)** On warm-null return, send a **second** `interaction.editMessage` to disable the Open Editor button (set `.setDisabled(true)`) so clicking it is impossible. Cleanest UX; requires tracking the original message id since the interaction is acked.
  - **(b)** On warm-null return, replace the "Ready to edit" embed entirely with the error state via `interaction.editReply` (in place of the followUp). Removes the stale button by replacing its container. UX is clearer (one message, one state) but requires rework of the `loadCharacterSectionData` error-reply path since it currently sends a followUp, not an editReply.
  - **(c)** Accept the double-error UX. The underlying state (character deleted) is rare enough that the edge case doesn't warrant the complexity. Log-only fix + documentation comment.

  Option (c) is what the code currently does. (a) or (b) are the UX improvements.

  **Start**: `services/bot-client/src/commands/character/truncationWarning.ts` `handleEditTruncatedButton` — the `if (warmResult === null)` block; `services/bot-client/src/commands/character/sectionContext.ts` `replyError` + `loadCharacterSectionData`. Demoted from Inbox 2026-04-22 — self-described UX noise, not data-safety.

- ✨ `[FEAT]` **Migrate Nyx persona from global CLAUDE.md to a user-level custom output style** — Nyx (the personality/tone/communication-rules block) currently lives in `~/.claude/CLAUDE.md` Universal Preferences. This works but couples persona with instruction-set content (safety rules, keybindings, Steam Deck env). Claude Code now supports custom output styles (see https://code.claude.com/docs/en/output-styles) — persona could move to a dedicated `~/.claude/output-styles/nyx.md` (or similar), leaving CLAUDE.md for mechanical prefs and safety constraints only. **Requirements**: (a) do NOT lose the "Explanatory" style's Insights-box format — user explicitly values that; the new style should merge Nyx persona + Explanatory format; (b) research what's actually customizable in output styles (full prompt override? delta layer?); (c) verify that the style activates automatically across all sessions (not per-project) since Nyx is a cross-project persona; (d) determine whether merging two styles (Nyx + Explanatory) is supported or if we need to fork Explanatory's template and add Nyx to the fork. **Investigation steps**: (1) fetch and read https://code.claude.com/docs/en/output-styles end-to-end; (2) inspect `~/.claude/output-styles/` (if exists) for existing style definitions; (3) inspect built-in styles for the Explanatory definition as a template; (4) pilot as `nyx.md` in a throwaway project before promoting to user-level default. **Start**: WebFetch the output-styles doc; `ls ~/.claude/output-styles/ 2>/dev/null` to see if the directory exists. Surfaced 2026-04-22. Demoted from Inbox — quality-of-life, no urgency, research-heavy.

- 🧹 `[CHORE]` **Investigate bot-client Pino log-level `info`-vs-`warn` drift** — While diagnosing the voice-engine over-size bug on 2026-04-19, the incident log entry `TTS audio exceeds Discord file size limit, skipping attachment` appeared as `level: "info"` in the Railway JSON stream even though `services/bot-client/src/services/DiscordResponseSender.ts:264` emits it via `logger.warn(...)`. Either Pino's numeric-level config is being flattened to `info` somewhere in the bot-client transport pipeline, or Railway's display layer is relabelling. Makes `railway logs --filter '@level:warn'` and similar severity-based filters unreliable across services. Verified 2026-04-22: `packages/common-types/src/utils/logger.ts:264-279` has no `formatters.level` override, so Pino's default emits numeric `40` for warn. The drift is happening downstream (Railway's mapping numeric → string incorrectly, or a transport in between). Not fixed by the PR #866 Pino-rules sweep. **Fix shape**: (a) pick a known `logger.warn` callsite in bot-client; capture a real emitted log from prod via `railway logs --json`; (b) compare the `level` field value to what Pino should emit per its level map (`warn = 40`); (c) trace the logger bootstrap + any Railway-side forwarding. **Start**: `services/bot-client/src/services/DiscordResponseSender.ts:264` (known warn call) + `packages/common-types/src/utils/logger.ts` factory. Cross-check against ai-worker logs — those DID emit `level: "info"` / `level: "error"` correctly in the same incident window, so the drift may be bot-client-specific. Surfaced 2026-04-19. Demoted from Inbox 2026-04-22 — observability gap, not actively blocking incident response.

### Triaged from Inbox 2026-04-21

_Items moved from Inbox during backlog-shrink pass. Full prose preserved — implementation detail, start-file pointers, and reasoning stay accessible for when a session picks any of these up._

- 🧹 `[CHORE]` **`detail.ts` silent-fail risk if imported in isolation post-PR-#856 refactor** — PR #856 moved the `registerBrowseRebuilder('deny', …)` call out of `browse.ts` into a dedicated `browseRebuilder.ts` that's imported by `deny/index.ts` at startup. Today's entry points (command loader → `index.ts`) all transitively load `browseRebuilder.ts` before any detail handler fires, so the rebuilder is always registered when needed. Residual risk (flagged by claude-bot review on PR #856 but intentionally not blocked): if a future test or code path imports `deny/detail.ts` directly without also loading `deny/index.ts` or `deny/browseRebuilder.ts`, the back-button / post-action rebuild path would silently fail to find a registered rebuilder — the symptom would be a "no rebuilder registered for 'deny'" log (or whatever the registry's miss-behavior is) and the user seeing a stale screen. **Fix shape**: either (a) add a defensive `import './browseRebuilder.js';` side-effect back into `detail.ts` (tradeoff: reintroduces the edge depcruise flagged, so only meaningful if we also teach depcruise to ignore side-effect-only imports, probably not worth it); (b) add a lightweight runtime assertion in the rebuilder-consuming code path (e.g. inside `handleSharedBackButton`) that logs an error if no `'deny'` rebuilder is registered — catches the failure mode without coupling detail.ts to the rebuilder module; (c) write an explicit integration test for the `detail.ts`-only import scenario that asserts the back-button fails cleanly (not silently). Option (b) is cheapest and most broadly useful (protects all four browse-capable commands, not just deny). Not urgent — single entry point today makes this theoretical. **Start**: `services/bot-client/src/utils/dashboard/sharedBackButtonHandler.ts` (or wherever the rebuilder registry is consumed); `services/bot-client/src/commands/deny/browseRebuilder.ts` for the registration-point JSDoc that already calls out this pattern.

- 🧹 `[CHORE]` **Periodic 8-point cleanup-sweep skill** — Inspired by a Shaw tweet (2026-04-20) prescribing an 8-subagent cleanup pass over a codebase: deduplicate/DRY, consolidate types, prune unused code (knip), untangle circular deps, remove weak types (`unknown`/`any`), remove defensive try/catch without purpose, remove deprecated/legacy/fallback code, strip AI-slop comments. We already enforce all 8 concerns **continuously** via CI (CPD, `common-types`, knip, depcruise, `strict: true`, 00-critical rules on error handling and "no backward compatibility", CLAUDE.md comment rules). Continuous enforcement is better for steady state — but it doesn't catch _accumulated drift_ that squeaks past linters (e.g., in-motion narration comments that no linter flags). **Fix shape**: add a `/tzurot-cleanup-sweep` skill under `.claude/skills/` that fans out parallel `Agent` invocations — one per concern — with a "report + implement high-confidence items only" contract. Runs quarterly or between epics as an audit. Keep continuous enforcement in CI; the skill is the explicit periodic deep-clean. **Deliberate divergence from Shaw's prescription**: we DO treat `unknown` as correct at system boundaries when paired with Zod — the skill's "weak types" agent should flag only `unknown` inside internal logic, not at boundary layers. **Start**: `.claude/skills/tzurot-arch-audit/` is the existing audit skill — use as the structural template; differ in that this one fans out to sub-agents and implements fixes rather than only reporting. Surfaced 2026-04-21 via Shaw tweet (@shawmakesmagic).

- 🧹 `[CHORE]` **AI-slop comment explicit hunt — periodic sweep** — Narrative-slop comments like `// Previously this did X`, `// Now updated to Y`, `// As part of PR #123`, `// Refactored from the old version`, or `// TODO(claude)` accumulate invisibly — no linter catches them, and CLAUDE.md's "no in-motion narration" rule depends on author discipline. A grep-based sweep every few releases is low-cost. **Fix shape**: a repo-wide grep for patterns like `// (Previously|Now|Formerly|Refactored|Updated|Changed|As part of|Per PR|Moved from|Extracted from)`, plus `// TODO(claude)` and bare `// AI:` markers. Report hits, hand-review each (some may be legitimate "why" comments that just use the trigger phrases), remove or rewrite the rest. Could live inside the cleanup-sweep skill above (entry #8), or as its own standalone skill/script. Possibly folds into a periodic `pnpm ops xray --comments-audit` subcommand. **First sweep done 2026-04-20** (commit `ca24d6f48`): size was ~24 hits across 19 files, of which 8 were genuine narrative-slop and got rewritten/removed; the rest were legitimate "why" comments using trigger words. Tell that worked: if removing the comment leaves a reader worse off, it earned its place. **Next sweep**: re-run after each release; expect single-digit new accumulations. Surfaced 2026-04-21 via Shaw tweet comparison.

- ✨ `[FEAT]` **Bring back v2 `/cleandm` command for removing bot-authored clutter from DM history** — v2 had a `cleandm` command that let users clear bot-posted non-conversation messages from their DM so the channel kept just the actual personality conversations. v3 regressed on this: verification prompts, help messages, error replies, and slash-command error responses accumulate in the DM and clutter the scroll-back. **Fix shape**: new DM-only slash command `/cleandm [scope:recent|all]` that (a) fetches the bot's own messages in the current DM channel (bots can only delete their own messages), (b) filters out any that match the personality-reply prefix `DM_PERSONALITY_PREFIX_REGEX = /^\*\*(.+?):\*\*/` from `DMSessionProcessor.ts`, (c) bulk-deletes the remainder respecting Discord's DM rate limit (~5 deletes/sec). **Architectural fit**: reuse the existing `DM_PERSONALITY_PREFIX_REGEX` as the "is this conversational?" classifier — it's already the rule `DMSessionProcessor` uses to decide session membership, so cleanup logic tracks any future prefix changes for free. **Scope options**: `recent` = last ~100 messages (fast, bounded); `all` = full-history sweep with progress updates and chunked deletion. Default to `recent`. **Start**: new command at `services/bot-client/src/commands/dm/cleandm.ts`. Add `.setContexts(DM)` + `.setIntegrationTypes(UserInstall)` on the SlashCommandBuilder so the command only surfaces in DMs. Surfaced 2026-04-20 during DM-broken investigation.

- 🧹 `[CHORE]` **Narrow the PostToolUse-hook payload jq paths after observational data arrives** — `.claude/hooks/pr-monitor-reminder.sh` currently tries three jq paths to extract `gh pr create` stdout (`.tool_result.stdout // .tool_response.output // .output // empty`) because Claude Code's PostToolUse payload shape isn't strictly documented. A stderr line fires on parse miss so drift is detectable. **Revisit after 3–5 PRs land via the hook**: if the stderr line never fires, the three paths are dead code — narrow to the single path the payload actually uses. If it fires every time, stdout parsing is dead weight and the `gh pr list --head` fallback is the only real code path — drop the parse entirely. Either way, remove the guesswork once data exists. **Start**: check `journalctl` / terminal history for `pr-monitor-reminder: no tool_result stdout available` lines across the next few PR cycles. Surfaced 2026-04-19 during PR #837 r5 review.

- 🧊 `[ICEBOX]` **UUIDv7 audit for other deterministic-UUID-from-mutable-input tables** — 2026-04-19 LlmConfig fix applied the same pattern Phase 5 personas used: random-UUID PK + `@@unique([ownerId, name])`. Other deterministic-UUID generators in `packages/common-types/src/utils/deterministicUuid.ts` should be audited: are they keyed off mutable user inputs, or off stable identifiers (Discord IDs, slugs)? **Candidates for same treatment**: `generateSystemPromptUuid(name)` — name is user-editable; any rename-then-recreate scenario could hit the same phantom collision. **Likely fine as-is**: `generateUserUuid(discordId)`, `generatePersonalityUuid(slug)` (slug is immutable/assigned), `generatePersonaUuid` (Phase 5 fixed this one). Audit-first, action-second. **Start**: enumerate each `generate*Uuid` in `deterministicUuid.ts`, cross-reference against the entity's schema to check if the seed source is mutable. Surfaced 2026-04-19.

- 🏗️ `[LIFT]` **Audit LLM response max-length to cap TTS-audio size at a defensible ceiling** — Post-Opus transcode, 64 kbps Opus keeps ~17 min of speech under Discord's 8 MiB attachment limit. The `voice_omitted_too_long.txt` fallback in `DiscordResponseSender.fetchTTSFiles` handles the residual, but if an LLM ever produces a response long enough to exceed 17 min of speech, the upstream problem (unbounded response length) is worse than the TTS drop — users would see a 17+ min audio attempt fail, and the same text would likely also be chunked across many Discord messages. No explicit max-response-length is enforced today. **Fix shape**: audit the generation pipeline's max-token configs in `services/ai-worker/src/services/` (probably `ConversationalRAGService` or model-config cascade); consider whether to cap response length at ~3000 chars (≈3 min of speech, comfortably under any ceiling). If implemented, the fallback attachment becomes structurally unreachable for the primary path and can be reduced to pure defense-in-depth. **Speculative — wait for residual data**: may never fire in practice if most responses stay under 2000 chars already. The `voice_omitted_too_long.txt` log frequency over the first week post-deploy is the empirical input for whether this audit is needed. Surfaced 2026-04-19 during voice-engine over-size fix.

- ✨ `[FEAT]` **Investigate Discord user-app integration capabilities** — Tzurot is currently installed as a server-scoped bot. Discord also supports "user app" installations where the bot is scoped to the user and can be invoked anywhere (including servers where the bot isn't installed, DMs, and group DMs). Slash commands already partially work in this form (noticed they can be used in other servers). Investigate: what else does user-app scope unlock? Could it make the bot semi-usable in group DMs? Could it improve 1:1 DM UX? What are the limitations (rate limits, permissions, webhook availability)? Low priority — scoping/scouting only until higher-priority work lands. **Start**: read Discord developer docs on user-install apps, compare feature matrix to our current server-install feature set, identify any UX gains specific to Tzurot's personality-chat model.

- 🐛 `[FIX]` **AI occasionally hallucinating response footer, causing duplication** — Rarely, models (observed with `z-ai/glm-4.5-air:free`) hallucinate the "Model: ... / FREE Using free model" footer text into their response content, which then gets the real footer appended on top — resulting in doubled footer lines. Very rare but user-visible. Investigate whether post-processing already strips known footer patterns; if not, add a cleanup step in `ResponsePostProcessor` or the response sender that detects and removes hallucinated footer content before the real footer is appended. Related: the LLM duplicate/looping response detection item may share post-processing infrastructure. **Start**: grep for footer-appending logic (likely in bot-client response sender or ai-worker post-processor), check if any existing stripping handles this pattern.

- 🐛 `[FIX]` **LLM duplicate/looping response detection** — GLM-5 observed producing responses with repeated content blocks (same paragraphs appearing twice within one message). Post-processing should detect and deduplicate repeated paragraph-level blocks. Observed 2026-04-05 with `z-ai/glm-5`. **Start**: `services/ai-worker/src/services/ResponsePostProcessor.ts` — add a deduplication step; `services/ai-worker/src/utils/responseArtifacts.ts` — may fit alongside existing cleanup patterns.

- 🏗️ `[LIFT]` **Rate limit `/voice-references/:slug`** — Unauthenticated endpoint serving binary audio from DB. Low urgency (Railway private networking limits exposure).

- 🏗️ `[LIFT]` **Dynamic free model selection from OpenRouter** — Replace hardcoded `FREE_MODELS` / `VISION_FALLBACK_FREE` with a query layer on `OpenRouterModelCache`. Models go stale when sunset. **Start**: `services/api-gateway/src/services/OpenRouterModelCache.ts`.

<!-- "Inspect command privacy toggle" entry superseded 2026-04-25 by the Inspect UX Hardening mini-epic in Current Focus, which implements default-on redaction for non-owners (no per-personality toggle needed). -->

- ✨ `[FEAT]` **Character import — optional voice file support** — Accept optional voice reference audio alongside character data import.

- 🏗️ `[LIFT]` **Standardize over-long field handling pattern across commands (rule-of-three watch)** — Two consumers now have the two-flow pattern (detection + destructive-action warning + explicit opt-in; "View Full" for reads): `/memory` via `detailModals.ts:61-156` and `/character` via `truncationWarning.ts` (shipped in PR #825 / beta.100). The pattern is duplicated, not shared. Per rule-of-three, the third consumer triggers extraction into a shared utility `services/bot-client/src/utils/dashboard/overLongFieldWarning.ts`. Likely third-consumer candidates: personas with long `content`, presets with long `systemPrompt`. **Action**: (1) Audit persona and preset edit flows for silent `slice(0, maxLength)` truncation sites — grep `services/bot-client/src/commands/{persona,preset}/` for `slice` and `setValue`. (2) When the audit surfaces a real data-loss case, fix it AND extract the shared utility in the same PR (migrate memory + character + new-consumer to the shared module). (3) If no third consumer surfaces naturally, leave as-is — the duplication cost is bounded and the two implementations are small. **Start**: `services/bot-client/src/commands/memory/detailModals.ts:61-156` (memory impl), `services/bot-client/src/commands/character/truncationWarning.ts` (character impl), `services/bot-client/src/commands/{persona,preset}/` for audit targets.

- 🧹 `[CHORE]` **Periodic audit of `scripts/` for patterns to promote to `packages/tooling/`** — `scripts/` is documented as a home for one-off data migration / codegen / investigation scripts that run once and are deleted. But over time the category accretes permanent-ish files (current subdirectories: `analysis/`, `data/`, `debug/`, `deployment/`, `migrations/`, `testing/`, `src/db/`, etc.) that suggest some "one-offs" actually repeat. When a pattern has 3+ sibling scripts, it's graduated past "one-off" and should become a `pnpm ops` command with structured options, tests, and doc. Audit rule: when adding a new `scripts/` file, check `scripts/` for sibling files with similar shape; if 3+ exist, promote. Schedule a quarterly audit to catch accreted patterns. **Start**: `find scripts/ -name '*.ts'` to enumerate, group by shape, identify 3+ sibling clusters as promotion candidates.

- ✨ `[FEAT]` **Cross-channel context slice via message-link range** — Users want to import a specific slice of another channel's history into the current conversation by giving a start and end marker (message ID or message link), not just individual messages. Today the only reliable way to pull other-channel context is to paste a bunch of message links one-by-one and let the reference parser expand each — messy, tedious, and doesn't preserve ordering well for long ranges. Distinct from LLM-driven auto-retrieval path; this is explicitly user-driven bulk import of a known range. **Investigation (2026-04-13)**: infrastructure is ready, but there's a security prereq. Location is `services/bot-client/src/handlers/references/`. Clean Parser → Resolver → Formatter architecture. Strategy pattern already in place: `handlers/references/strategies/` has `ReplyReferenceStrategy` and `LinkReferenceStrategy`. A new `MessageRangeStrategy` plugs in as a sibling — no architectural refactor needed. Estimated ~100–150 LOC. **🔴 CRITICAL security finding — permission check is bot-only, not user-scoped**: `LinkExtractor.fetchMessageFromLink()` (lines 124-251) fetches via `sourceMessage.client` (the bot's own Discord credentials). It verifies the bot has access; it does NOT verify the invoking user has access to the source channel. This is already a live info-leak vector in single-link expansion. **A range-import feature would inherit and amplify this (1 link → N messages).** Fixing the permission check is a hard prerequisite for safely shipping range-import. **Start (when a session picks this up)**: fix `LinkExtractor.fetchMessageFromLink()` user-permission check first; then create `handlers/references/strategies/MessageRangeStrategy.ts` + `MessageRangeExtractor.ts`; plug into `ReferenceCrawler.ts`.

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Personality Aliases** - User-managed alternative names for personalities. v2 had: multi-word aliases (1-4 words, longest-match priority), smart collision handling (append name parts, then random suffix), auto-alias creation from display names, and alias reassignment between personalities. Single-level indirection only (alias → personality ID, no chains). v3 already has `PersonalityAlias` model in schema.
- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Latent (relevant only if specific triggers fire)

#### 🐛 Near-duplicate consecutive replies on `glm-4.5-air:free` — observability primed, awaiting next incident

Diagnostic PR landed 2026-04-19 with full `CrossTurnDetection` logging (per-message `comparisonReport` with hash, 80-char prefix, Jaccard and bigram scores), race-window telemetry in `ContextStep`, and reasoning-mode engagement telemetry in `ResponsePostProcessor`. Latent now — no further action until the next user-reported occurrence gives us data to correlate.

**Ruled out (do not retry)**: request-hash cache busting (nonce in system prompt didn't help), temperature jitter (breaks this model's output quality), threshold adjustment (council math 2026-04-19 showed genuine near-duplicates would score ≥0.95 Jaccard, so prod's 0.72-0.78 band is baseline persona overlap, not almost-caught duplicates).

**Working hypothesis**: model-inference-level stickiness on the Z-AI provider side — not something we can prevent at the request layer.

**Runbook when user reports next duplicate**:

1. Get approximate UTC time, channel ID, personality, whether reasoning mode was requested.
2. `railway logs --service ai-worker --json | jq -c 'select(.name == "CrossTurnDetection")' | grep <jobId or time window>` — inspect `comparisonReport`.
3. Check for `[ContextStep] Race-window signal` warnings near that time. If present, DB write-read race is the cause.
4. Check `[ResponsePostProcessor] Reasoning mode requested but did NOT engage` — correlation with incidents tells us whether reasoning-mode reliability is part of the story.
5. If none explain it, model-inference-stickiness stands. Potential mitigations: swap models for specific users, add user-facing "regenerate" button, or accept residual given low frequency.

**Why Latent**: we've done the pre-work; the next move requires an incident to correlate against. Surfaced 2026-04-19.

#### ✨ Discord system-message handling (welcome/join events in activated channels)

Open question: when a user joins a guild where the bot is activated in the welcome channel, Discord emits `MESSAGE_CREATE` for the system-generated join message. Does the bot currently see these? Do they arrive as empty-content messages (and fall into whatever guard handles empty content), or as typed system messages with `message.system === true` and a known `MessageType` (`UserJoin`, `GuildBoost`, `ChannelPinnedMessage`, etc.)? If unhandled, the risk is (a) silent pass-through to AI with empty input, (b) duplicate responses, or (c) they're dropped entirely and we miss a UX opportunity for personality-aware welcomes.

**Investigation steps**:

1. Grep `MessageType.UserJoin`, `message.system`, `isSystem` across `services/bot-client/src/handlers/MessageHandler.ts` + `PersonalityMessageHandler.ts` — is there explicit handling today?
2. Test in a local guild by joining with a second account — observe what fires in ai-worker logs.
3. Inspect `message.content` for system messages (typically empty string with `message.system === true`, `message.type === MessageType.UserJoin`).

**Decision after investigation**: ignore explicitly (safest default, ship as guard), respond with personality-aware welcome (feature opportunity, opt-in per guild), or surface only when channel explicitly configured for welcomes.

**Why Latent**: no active user pain; `[FEAT]` investigation that only becomes relevant if a concrete welcome-UX use case appears. Surfaced 2026-04-21.

#### 🏗️ Singleton-hazard guard for `UserService` cache

Relevant only if `UserService` is ever refactored from per-request instantiation to a singleton (a reasonable perf improvement).

`UserService.getOrCreateUserShell` intentionally does NOT write to `this.userCache` to prevent a subtle bug: in a singleton context, a shell call would cache a `discordId → userId` mapping, causing subsequent `getOrCreateUser` calls to short-circuit out of the cache and skip `runMaintenanceTasks` (username upgrade + persona backfill). Today's per-request instantiation keeps the cache cold, so this is latent.

Hazard is documented in the cache field's JSDoc (`packages/common-types/src/services/UserService.ts`). Options if UserService is made a singleton: (a) split the caches so shell and full have separate tracking; (b) move username upgrade/persona backfill out of the hot-path into an explicit "ensure provisioned" method callers invoke. Flagged by PR #805 review.

#### 🐛 Voice engine (Pocket TTS) intermittent failures

_Superseded by TTS engine upgrade epic in Current Focus._ Pocket TTS is being replaced by Chatterbox Turbo (research done 2026-04-12, evaluation in progress). Any fix to Pocket TTS would be throwaway work once the replacement ships. Revisit only if the TTS epic stalls for multi-session reasons.

#### ✨ "Cough fallback" pre-recorded audio for TTS failure (RP immersion)

Even after the Opus transcode + `voice_omitted_too_long.txt` fallback (shipped 2026-04-19), an unrecoverable TTS failure still breaks roleplay fiction — the user sees a text attachment named "voice_omitted_too_long" instead of hearing the character. Council raised the idea (2026-04-19) of a pre-recorded 1-sec neutral audio clip (sigh, static, ambient breath) that plays when voice synth hits a terminal error. Maintains character immersion at the cost of mild ambiguity (user might not realize it's an error state).

**Fix shape**: pre-record a short (~1 sec, <50 KB) audio asset; wire it into `DiscordResponseSender.fetchTTSFiles` as a final fallback after the text-attachment branch; consider per-personality opt-in (some characters may want a specific voiced "sorry, couldn't speak" instead of generic ambient sound).

**Why Icebox**: pure polish. The `voice_omitted_too_long.txt` attachment already gives the user a visible signal that voice was attempted. The cough fallback is a UX upgrade, not a correctness fix. Revisit if users report the text-attachment signal feels jarring for specific personalities.

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Partially done: migrated from `include_reasoning` to modern `reasoning` param via `modelKwargs`. But the custom fetch wrapper in `ModelFactory.ts` that intercepts raw OpenRouter HTTP responses and injects `<reasoning>` tags is still fragile — LangChain's Chat Completions converter silently drops `reasoning` fields, so we intercept before it parses. Needs a cleaner approach (e.g., native Responses API support from OpenRouter, or a LangChain plugin).

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Prompt Caching (Anthropic)

Add `cache_control` breakpoints to static prompt sections (character profile, response protocol) for Anthropic models via OpenRouter. Deferred Phase 4 from the XML prompt restructure.

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

#### 🏗️ Platform Abstraction Layer — decouple UX from Discord

**Origin (stream of consciousness, 2026-04-13)**: what if there were a translation layer between _the user interactions I want_ and _what Discord slash commands actually look like_? Framed two ways:

1. **Portability hedge**: Discord may stop being a viable platform at some point, and we don't want to be caught flat-footed. A layer that encodes "what experience do I want users to have" separately from "how does Discord express that" would make retargeting to Stoat (née Revolt), a web UI, or any other arbitrary platform a matter of writing a new adapter rather than rewriting every command.
2. **Near-term DX**: a standardized DSL for building slash commands quickly and easily — on top of (and in the same spirit as) the ongoing CPD reduction / duplication cleanup. Instead of each command hand-rolling a `SlashCommandBuilder` tree + bespoke option parsing + bespoke handler wiring, a small in-house builder describes "a command with these options and this intent," and generators produce the Discord registration, the dispatch, and (eventually) any alternate-platform adapter.

**Why it's in Icebox and not deleted**: (a) the CPD reduction work (subcommand router consolidation, browse helpers, dashboard session/modal utilities) is already pushing toward this shape without anyone asking for it — if a DSL eventually crystallizes, it should crystallize the patterns the consolidation work has already validated, not invent new ones; (b) it's the right frame if/when Discord does become untenable, and having thought about it is cheaper than needing it without having thought about it.

**Revisit when**: (1) CPD is at a low baseline and the remaining command boilerplate visibly wants to be a builder function (`defineSlashCommand({ name, options, intent, onInvoke })`) rather than raw `SlashCommandBuilder` chains, or (2) a concrete portability requirement appears (Discord API change, new platform target, web UI project).

**Current state (2026-04-13 investigation)**: the codebase is already **~45–55% DSL-shaped**. `defineCommand()` at `services/bot-client/src/utils/defineCommand.ts:57-162` already serves as the DSL nucleus — it enforces command contracts, abstracts deferral modes (with context-type variance: `ModalCommandContext` vs `DeferredCommandContext` vs `SafeCommandContext`), and declares component routing via `componentPrefixes`. Shared utilities cover browse/dashboard/session/modal patterns comprehensively (see table in `.claude/rules/04-discord.md`). Empirical utility-call density: browse commands ~7% of LOC, dashboard commands ~13%.

**What `defineCommand` does NOT yet absorb** (the residual boilerplate a full DSL would need to cover): `SlashCommandBuilder` chain construction (e.g., `commands/character/index.ts:215-388` is 174 LOC of Discord.js tree), option parsing via per-command codegen helpers, subcommand routing via external factories (`createMixedModeSubcommandRouter`, `createTypedSubcommandRouter`), error-handling try-catch wrapping, and `ModalBuilder` / `TextInputBuilder` chains.

**What Phases 5–6 of the Active Epic would push further**: `requireDashboardSession` (~8 clones), dashboard modal/select handlers (~6 clones), subcommand router consolidation (~3 clones). After those land, ~35–50 LOC per command remains as essentially irreducible `SlashCommandBuilder` + `ModalBuilder` tree construction. That's Discord.js API surface and can't go into a utility without either (a) code generation, (b) a declarative schema compiler, or (c) a thinner-than-Discord.js DSL that accepts less API control.

**Framing insight**: a realistic DSL could eliminate 50–60% of per-command boilerplate; the remaining 40–50% IS the Discord.js API surface — which is also exactly what a cross-platform abstraction layer would need to replace. So the irreducible-boilerplate problem and the portability problem are the same problem viewed from two angles. This suggests the "revisit" trigger isn't really about CPD reaching zero — it's about whether the cost of a schema compiler or code generator is worth paying, which correlates with how seriously we're pursuing portability.

**User's own framing**: "Probably a bit pie in the sky, but I want to at least think about it."

### Code Quality

#### 🧹 Mock Convention Unification Audit

The codebase has two mock conventions side-by-side: `src/test/mocks/*.mock.ts` explicit-import libraries (~10 files in ai-worker + bot-client, pre-existing) and `src/services/__mocks__/AuthMiddleware.ts` vitest auto-discovery (1 file, added in PR #883). The split serves two real mechanisms — factory-libraries that can't be tied to a specific module path vs. module-replacement mocks that vitest auto-resolves — but nobody audited which existing `.mock.ts` files actually need explicit-import flexibility vs. which are single-module replacements that could migrate to `__mocks__/` for DRY.

**Scope**: ~10 files to audit, ~5-7 likely migrate, ~2-3 stay as factory libraries. ~2-3h.

- **Initial-skim candidates for migration**: `ai-worker/src/test/mocks/{LLMInvoker,PromptBuilder,ContextWindowManager,LongTermMemoryService,MemoryRetriever,ReferencedMessageFormatter,UserReferenceResolver}.mock.ts` + `bot-client/src/test/mocks/PersonalityService.mock.ts`.
- **Stay as-is**: `bot-client/src/test/mocks/Discord.mock.ts` + `ai-worker/src/test/mocks/utils.mock.ts` are factory libraries, not module replacements.

**Deliverables**: (a) per-file audit notes; (b) migrations for qualifying files; (c) caller updates (`vi.mock(path)` with no factory); (d) rule in `.claude/rules/02-code-standards.md` documenting "use `__mocks__/` for module replacement; use `.mock.ts` library for reusable factories not tied to a single module."

**Tried and rejected on PR #883**: explicit `vi.mock(path, () => import('./.mock.ts'))` pattern with an imported factory — fails with circular-mock reentry when the mock file uses `export *` AND with `ReferenceError: Cannot access '__vi_import_0__' before initialization` when the factory is an imported symbol (vitest hoists `vi.mock` above imports). `vi.hoisted()` workaround reconstructs per-file boilerplate. The `__mocks__/` auto-discovery is vitest's purpose-built escape hatch for the same-package DRY case.

Surfaced 2026-04-23.

#### 🏗️ Unify Shapes Job Error Handlers

`handleExportError` (ShapesExportJob.ts) and `handleImportError` (ShapesImportJob.ts) are near-identical: `willRetry` computation, three-way log message, re-throw or mark DB as failed. Extract to a shared helper in `shapesCredentials.ts` or a new `shapesJobHelpers.ts`.

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Low-Priority Audits

- **Audit API Routes for Zod Validation** — Several routes use manual `typeof` + `isValidDiscordId()` instead of Zod schemas at boundaries. Large scope, no recent production impact. Discovered PR #688.
- **DB-Sync Deletion Propagation** — Cross-env sync only upserts, so prod deletions get undone on re-sync. Workaround: manual cleanup. Needs design decision (tombstones, deletion log, sync manifest). Low urgency.

### Nice-to-Have Features

- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook
- **Remove Dashboard Close Button** - Redundant with Discord's native "Dismiss Message" on ephemeral messages. Sessions auto-expire via Redis TTL (15 min) anyway.
- **Align Preset Browse UX with Character Browse** - Characters group by owner with clear section headers and consistent emoji badges (from the Emoji Standardization epic). Presets still use a flat list with ad-hoc badging. Needs: owner grouping, standardized emoji badges, consistent legend formatting.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🏗️ Slash Command UX Audit

Full audit of all slash command UI patterns. Review shared utilities usage, identify gaps/inconsistencies, standardize patterns.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

#### 🐛 Revisit Vision `maxAttempts` After Telemetry Data

**Problem**: Vision retry cap set to `maxAttempts: 2` (1 initial + 1 retry) on 2026-04-14 without empirical retry-success-rate data for AbortError-originated TIMEOUT errors. Council argued for 1 attempt (0 retries) on the assumption that 90s-budget AbortErrors are near-100% deterministic per URL. Kept 2 attempts until measurement proves otherwise.

**Action**: After 1–2 weeks of prod telemetry from the vision-pipeline diagnostic bundle, grep ai-worker logs for `attempt=2` successes on operations where `attempt=1` failed with `errorCategory=timeout`. If retry success rate on TIMEOUT is <5%, cut `VISION_MAX_ATTEMPTS` in `services/ai-worker/src/jobs/ImageDescriptionJob.ts` to 1. If >20%, keep at 2. Between, reconsider with fresh eyes.

**Why out of scope now**: Cannot decide empirically without the telemetry the diagnostic bundle installs.

#### 🧹 Deduplicate `parseApiError` Calls in Retry Path

**Problem**: `ImageDescriptionJob` (and other vision-adjacent callers) pass both `shouldRetry: shouldRetryError` and `getErrorContext: getErrorLogContext` to `withRetry`. Each wrapper internally calls `parseApiError(error)`, so every failed attempt parses the same error twice. Not a correctness issue — both return the same result for a given input — but inefficient if the parser grows more expensive (e.g., deeper cause-chain traversal, richer classification).

**Action**: Add an optional `getErrorContext` variant that receives a pre-parsed `ApiErrorInfo` instead of raw error, or have `withRetry` expose the parsed info from its own `shouldRetry` call into `getErrorContext`. Either approach removes the duplicate parse without changing the external surface for callers that don't need it.

**Why out of scope**: Efficiency nit flagged during PR #802 review; the parser is currently cheap (regex + switch) so duplication is zero-impact in practice. Fix when touching the retry primitive for other reasons.

#### 🐛 `modelName` Lost as Structured Attribute Field After LLMInvoker Log Deletion

**Problem**: PR #802 deleted the `[LLMInvoker] LLM invocation completed` log which had `modelName` as a top-level structured field (queryable via Railway DSL `@modelName:claude-sonnet-4-6`). The replacement `withRetry` success log embeds model name inside `operationName: "LLM invocation (claude-sonnet-4-6)"` — still substring-searchable but no longer an attribute filter. Per-model latency/success-rate queries are harder.

**Action**: Add an optional `extraLogFields: Record<string, unknown>` option to `RetryOptions` that spreads into every lifecycle log. `LLMInvoker` can then pass `extraLogFields: { modelName }` to restore the structured field without reintroducing a second log line. Alternative: extract model name from `operationName` via a Railway query macro — less ergonomic.

**Why out of scope**: Legit queryability regression but low priority for a solo-dev workflow where substring search suffices. Right home is the Observability & Telemetry Strategy epic in Future Themes — that epic will standardize the `extraLogFields` / `dimensions` pattern across all retry-like primitives.

#### 🐛 Revisit `TIMEOUTS.VISION_MODEL` After Telemetry Data

**Problem**: 90s vision-model timeout may be mis-calibrated. 63% hit rate in 2026-04-14 prod-log analysis suggests systemic (provider/CDN stall) rather than "almost-long-enough." If p95 successful response times are 25–35s, 90s is 2–3x overkill.

**Action**: After 1–2 weeks of prod telemetry, analyze `durationMs` distribution from `[Retry] Image description succeeded on attempt` log entries. Tune `TIMEOUTS.VISION_MODEL` in `packages/common-types/src/constants/timing.ts` to p99 + small headroom.

**Why out of scope now**: Cannot tune without the telemetry the diagnostic bundle installs.

---

## ⏸️ Deferred

_Decided not to do yet._

| Item                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs                                   | No breaking changes yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Contract tests for HTTP API                                         | Single consumer, but middleware wiring tests needed (see Inbox). Revisit after wiring audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Redis pipelining                                                    | Fast enough at current traffic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| BYOK `lastUsedAt` tracking                                          | Nice-to-have, not breaking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Handler factory generator                                           | Add when creating many new routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Scaling preparation (timers)                                        | Single-instance sufficient for now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Denylist batch cache invalidation                                   | Single pubsub messages handle current scale; premature optimization for bulk ops that rarely happen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Deny detail view DashboardBuilder migration                         | Action-oriented UI (toggle/edit/delete) doesn't fit multi-section edit dashboard pattern; already uses SessionManager and DASHBOARD_MESSAGES                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `memory_only` import ownership check                                | Not a bug — memory_only imports should work across personality owners since memories belong to the importing user, not the personality owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm/action-setup` v5→v6 upgrade                                   | Investigation 2026-04-17: v6 only adds pnpm 11 support; we use pnpm 10.30.3 (`packageManager` in package.json). v6 replaces the bundled pnpm with a bootstrap installer (see compare v5...v6: `dist/pnpm.cjs` removed, new `src/install-pnpm/bootstrap/`), which caused `ERR_PNPM_BROKEN_LOCKFILE` in our CI. Zero benefit for us on pnpm 10.x. Revisit if: (a) we adopt pnpm 11, (b) v5 is deprecated, (c) a v6.x patch fixes the bootstrap's pnpm version resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| JobTracker orphan-sweep user-visible message                        | When the 40-min orphan sweep fires, `completeJob` silently deletes the "taking longer" notification with no replacement, so the user just sees the notification disappear. Flagged in PR #820 round 2. Decided not to surface a user-visible message because: (a) orphans require a worker crash or Redis partition — rare in practice, (b) the `logger.warn` in `scheduleOrphanSweep` is the correct signal for ops. Revisit if we see the silent-disappear UX cause real user confusion. Start: `services/bot-client/src/services/JobTracker.ts` `scheduleOrphanSweep`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| JobTracker "Completed job" log on orphan-release                    | `completeJob` emits `logger.info("Completed job after Xs")` regardless of why it was called, so an orphan-sweep release at 40 min reads like a successful completion in logs. Flagged in PR #820 round 2. The preceding `logger.warn` from `scheduleOrphanSweep` provides correlation context, and passing an `isOrphan` flag (or splitting into a separate `forceReleaseJob` method) adds complexity for a rare path. Revisit if we need to distinguish these in aggregated log queries. Start: `services/bot-client/src/services/JobTracker.ts` `completeJob`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Kimi K2.6 plain-text reasoning leak heuristic extractor             | Kimi K2.6 via OpenRouter (`moonshotai/kimi-k2.6`) emits chain-of-thought as plain narration terminated by `"Final decision:\n<answer>"` — no structural markers, OpenRouter doesn't extract it as reasoning. Council (Gemini 3.1 Pro Preview, 2026-04-21) recommended Option 2 (split-on-`"Final decision:"` heuristic) but we **deliberately chose NOT to build** it: (a) false-positive risk on legitimate roleplay ending in "Final decision:" phrasing, (b) reasoning content itself is low-value narration (personality rehashing, format debating) that doesn't justify the cost. **What SHIPPED 2026-04-21**: per-model `reasoning-did-not-engage` warn log in `ResponsePostProcessor.ts` so log searches can grep `@level:warn AND "did NOT engage"` with a `modelName` field. **User-facing action**: recommend `reasoning.enabled: false` on any preset pointing at `moonshotai/kimi-k2.6` — strictly better UX for this model given the content quality. **Upstream**: file OpenRouter issue asking them to recognize Kimi K2.6's `"Final decision:"` delimiter and populate `message.reasoning`. Revisit if (a) a future Kimi release produces high-quality reasoning with the same broken structure, or (b) users report preferring K2.6-with-reasoning despite the cost/quality trade-off. Deferred 2026-04-22. |
| Typed aggregated error for `DownloadAttachmentsStep.downloadAll`    | Per-attachment failures inside `downloadAll` are typed (`HttpError`, `AttachmentTooLargeError`), but the step-level aggregation collapses into anonymous `new Error('Failed to download N attachment(s): ...')`. Callers (`LLMGenerationHandler.processJob`'s catch) can't `instanceof`-classify without string-parsing. **Acceptable today**: failure surfaces to user as async error regardless of classification; no retry/backoff policy keys off the aggregated type. **Fix shape when needed**: introduce `AggregateAttachmentDownloadError extends Error` carrying `failures: Array<{ name: string; error: Error }>`, keep message format for log compat. **Promote when**: we want differentiated retry policy ("retry whole job if all failures are transient" vs "fast-fail if any 403") or differentiated user-facing messages by failure class. Surfaced 2026-04-24 by PR #889 Round 6 claude-review. Deferred 2026-04-24.                                                                                                                                                                                                                                                                                                                                                                                        |
| Reconsider hard-fail vs soft-error for attachment download failures | PR #889 changed semantics: old `AttachmentStorageService.downloadAndStore` used `Promise.allSettled` and returned the original Discord CDN URL as fallback on per-attachment failure (soft-error; job continued with broken URL); new `DownloadAttachmentsStep.downloadAll` throws on any failure and fails the whole job (hard-fail). New behavior is arguably more correct (old soft-error handed LLM a dead URL that produced weird responses), but it's a visible user-facing change — transient CDN hiccups that were previously silent now produce classified async errors. **Watch-item**: if users report "attachments dropped without warning" → "job failed visibly" complaints, reconsider partial-failure soft-error (continue with successful attachments, surface non-fatal warning for failed ones). **Fix shape when needed**: change `downloadAll` to keep partial successes, attach failure metadata to generation context, surface "couldn't load N of M attachments" notice. **Why deferred today**: no observed user complaints; visible errors easier to diagnose than silent corruption. Surfaced 2026-04-24 by PR #889 Round 5 claude-review. Deferred 2026-04-24.                                                                                                                                    |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- Shapes.inc import: Phases 1-4 complete on develop (see Character Portability theme)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md) - Voice engine research summary + implementation map
