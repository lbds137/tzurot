## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

### Theme: Periodic Audit Enforcement Architecture

_Focus: ensure the ~7 ops commands + 2 slash skills documented as "run periodically" actually get run — without a system that itself rots or becomes notification spam._

**Full proposal**: [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md). Synthesized from a 4-model council pass (Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7) on 2026-05-22.

**Phases:**

1. **Layer 1 — Canary + golden fixture for 2 least-trusted tools.** ~2 days, runs in regular CI (not cron), foundational because everything else depends on the audits actually working. Build this first; survives even if the rest is never built.
2. **Layer 2 — `WHY.md` per tool.** ~10 min/tool. Delete any tool whose WHY can't be articulated.
3. **Layer 3 — Baseline `meta` blocks** (tool version, config hash, node version, commit SHA) so age-gate fires on config-hash mismatch too, not just calendar days.
4. **Layer 4 — Dumb `pnpm ops:health` aggregator.** Output only, no enforcement yet.
5. **Layer 5 — Weekly GitHub Actions cron + out-of-band Discord webhook** (not via the bot — the bot IS the system being audited). One summary, no escalation ladder.
6. **Month-3 evaluation.** Are the summaries being read? If yes, add 45-day CI age-gate. If no, the system is dead and more enforcement won't save it. **Do NOT pre-build the escalation ladder.**

**Why deferred**: bigger than a quick-win, smaller than a full epic. Sits in the "structural quality" bucket per the recovery-period quality-over-velocity goal.

### Theme: User-feedback solicitation + revive v2 release-notes delivery

_Focus: structured channel for soliciting feedback from non-direct-contact users — feedback today only arrives ad-hoc._

As broader UX issues come up (channel-activation behavior, voice handling, persona switching, etc.), a structured channel for hearing from users who aren't in direct contact with the operator would be valuable. Could double as the delivery path for the v2 release-notes feature (announce each release to interested users) that was lost in the v3 rewrite.

**Phases:**

1. **Opt-in/opt-out persistence** — likely a new column on the user row or a separate `user_preferences` table. Default-opt-in vs default-opt-out is the key design question.
2. **DM-blast job worker** — BullMQ scheduled job that iterates the opt-in cohort and sends a DM. Rate-limit-aware (Discord caps DMs from bots; bulk needs throttling). Idempotent retries on failure.
3. **`/admin broadcast` command surface** — bot-owner-only; accepts a message template + dry-run preview + opt-out compliance check before send.
4. **Release-notes integration** — wire the same delivery path to a CHANGELOG-driven announcement on release-PR merge (or manual trigger).

**Promote when**: ready to ship a meaningful UX change that benefits from broad-base feedback, OR when re-implementing the release-notes delivery feature. Surfaced 2026-05-17 in personal notes. Triaged 2026-05-19 to future-themes.

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
- **"Max age: off" should override global setting; separate "off" from "inherit"** — In the settings cascade, "off" (disabled) and "inherit" (use parent value) are conflated into one state. When a user sets max-age to "off" at a level where the global has a value, "off" should still mean "disabled" — it should not fall through to the global. The same issue may affect other cascade items (TTS provider, LLM config, etc.). **Fix shape**: audit all settings cascade fields for off-vs-inherit semantics; introduce a distinguishable "off" sentinel value (e.g., `null` = inherit, `false` = explicitly off, or a discriminated union). Ensure the resolver treats "off" as a terminal "no max age" rather than "use parent". Scope depends on how many cascade fields have this conflation. **Concrete plumbing follow-up**: `computeHistoryCutoff(maxAgeSeconds, contextEpoch)` in `historyCutoff.ts` currently treats `null` and `undefined` identically (both → no filter). The "off" semantic needs richer types like `{ kind: 'inherit' } | { kind: 'off' } | { kind: 'value'; seconds: number }` so cascade resolvers can distinguish "user explicitly set off, override global" from "user didn't touch this, inherit". Naturally aligns with goal #2 above (standardize cascade UX with pin/inherit/clear semantics). Surfaced 2026-05-02; promoted from quick-wins 2026-05-12 — not quick-win sized (cross-cutting cascade audit).

**Start**: `packages/common-types/src/services/LlmConfigResolver.ts:141` (cascade logic); `services/bot-client/src/commands/settings/preset/` (user-tier template); `services/bot-client/src/commands/character/dashboardButtons.ts` (add section); `services/ai-worker/src/jobs/ShapesImportHelpers.ts:41` (shapes pin path to preserve).

**Related proposal**: [`docs/proposals/backlog/config-cascade-design.md`](../docs/proposals/backlog/config-cascade-design.md) covers the broader "unified configuration cascade" vision. Phase 1 (model validation + context window enforcement) shipped 2026-02-16. Phases 2–5 (LlmConfig slimming, lightweight overlay system, voice/image user overrides, focus mode tier expansion) are the deferred work that overlaps with this theme.

### Theme: `/character chat` — push-based result delivery + DM support (PersonalityChatManager extract)

_Focus: merge two related refactors into one epic. (1) `/character chat` polls for job results with a 2-min cap, orphaning long-running free-model jobs; (2) `/character chat` hard-errors in DMs because its render path is webhook-only. Both want to extract logic so slash-command and message-handler entry points share the same infrastructure._

**Sequencing**: Do BEFORE TTS-epic PR 3 continuation. The orphan-job class is an active production bug affecting free-model users only — paid-model users are unaffected because they finish under the 2-min cap. User chose structural fix over stop-gap timeout bump 2026-05-07. Production evidence: see `backlog/production-issues.md`.

#### The polling-vs-push asymmetry

`/character chat` polls `pollJobUntilComplete` at `chat.ts:100` with a 2-min cap from `TIMEOUTS.JOB_BASE`. `@personality` mentions use the push-based path: ai-worker → Redis stream → `ResultsListener` → `MessageHandler.handleJobResult` → context lookup via `JobTracker.getContext` → webhook delivery. Both paths deliver via webhook ultimately. The polling cap is a self-imposed limit far tighter than what Discord allows (interaction tokens last 15 min, and slash delivery already uses webhooks rather than the interaction token).

The polling design was ergonomic (synchronous-style code, simpler test mocks), not a Discord constraint. The 2-min cap was generous when set; reasoning models and free-tier OpenRouter latency made it inadequate.

#### DM gap (original theme scope, retained)

Typing `/character chat personality:Foo` in a DM produces "This command can only be used in text channels or threads." Regular `@CharacterName hello` works fine via `DMSessionProcessor` + `PersonalityMessageHandler`. Council rejected the DRY shortcut of synthesizing a fake `Message` from `Interaction` — different Discord APIs, footgun.

#### Fix shape (multi-PR epic)

**Phase A — Push-based result delivery for `/character chat`** (closes the production bug)

1. Generalize `JobTracker.PendingJobContext` to a discriminated union: `MessageJobContext` (existing shape, behavior unchanged) and `SlashJobContext` (new — `{ channel, personality, personaId, characterSlug, isWeighInMode, userMessageTime, guildId, requestId }`).
2. Extend `MessageHandler.handleJobResult` to dispatch on context kind; slash branch does what `pollAndSendResponse`'s post-result branch currently does (webhook delivery via `sendCharacterResponse`, error fallback with `buildErrorContent`, diagnostic-response-id update, conversation persistence).
3. Rewire `chat.ts`: replace `pollAndSendResponse` with `JobTracker.trackJob(jobId, channel, slashContext)` + early return.
4. Delete `pollJobUntilComplete` from `GatewayClient.ts` (sole caller is `chat.ts`; tests are mocks).
5. After interaction defer, `interaction.editReply` to a placeholder ("Working on it…") so the "thinking…" state doesn't sit forever. Optionally delete on result arrival.

**Phase B — Protocol-agnostic PersonalityChatManager extract** (closes the DM gap, council-blessed Option D)

1. Extract domain logic from `PersonalityMessageHandler.handleMessage` into `services/character/PersonalityChatManager.ts`.
2. Manager accepts `ChatGenerationRequest { userId, channelId, isNsfwChannel, personalityId, userPrompt, authorDisplayName }`, returns response payload.
3. Each entry point parses Discord objects, calls the manager, delivers in native protocol (plain reply for messages/DMs; webhook for guild slash; `interaction.followUp` for DM slash).
4. Belt-and-suspenders: if DM branch ever hits unsupported state, reply with "In DMs you can also just type @CharacterName hello — no slash command needed."

Phases can run independently or in either order; doing them together saves a round-trip on `chat.ts` rewrites.

#### Tests

- `chat.test.ts` (~1000 lines) is the bulk of the work — polling mocks become `JobTracker.trackJob` + slash-branch handler mocks.
- Integration test: long-running mock job → result lands via listener → orphan-sweep releases on genuine hang.

#### Risks

- Phase B touches a hot path shared by multiple processors — needs integration coverage across `DMSessionProcessor`, `BotMentionProcessor`, and slash command before landing.
- Diagnostic-response-id update is currently fire-and-forget after polling — needs to also be fire-and-forget from the new handler, but the call site shifts.
- Conversation persistence uses `userMessageTime` from the original interaction context — must be captured into `SlashJobContext` before the handler returns.

**Estimated scope**: 2–3 days focused.

**Start**: `services/bot-client/src/commands/character/chat.ts:100` (poll site); `services/bot-client/src/utils/GatewayClient.ts:250` (`pollJobUntilComplete` to delete); `services/bot-client/src/services/JobTracker.ts:44` (`PendingJobContext` to generalize); `services/bot-client/src/handlers/MessageHandler.ts:91` (`handleJobResult` to add slash dispatch); `services/bot-client/src/services/ResultsListener.ts:80` (subscription contract reference); `services/bot-client/src/services/PersonalityMessageHandler.ts` (Phase B source); `services/bot-client/src/processors/DMSessionProcessor.ts` (Phase B second caller). Council consultation 2026-04-20 (Gemini 3.1 Pro Preview) for Phase B.

Surfaced 2026-05-07 (production bug merged into prior PersonalityChatManager extract theme).

### Theme: Schema Audit for Nullable-That-Isn't FK Columns

_Focus: find other schema concessions like the Phase 5b `default_persona_id` nullability that was a code-convention workaround, not a real application state._

Phase 5b's NOT NULL fix revealed a pattern: `users.default_persona_id` was nullable at the DB level not because `null` was a meaningful application state, but because one code path (`getOrCreateUserShell`) was inconvenient to fix properly. Similar concessions likely exist elsewhere — this epic has found three load-bearing workaround patterns (`discord:XXXX` dual-tier, shell-user, null `default_persona_id`) in ~6 months of v3 development, suggesting more are hiding.

**Audit recipe**: (a) grep `prisma/schema.prisma` for `?` (optional) on FK columns and columns that are "always set" in application logic — for each, ask "can this actually be null in production, or is the app enforcing non-null via convention?"; (b) grep for default-value-that-never-applies patterns (columns with `@default` that callers always override); (c) grep Prisma `findUnique` / `findFirst` callers for `?.fieldName ?? fallback` patterns where `fallback` is never actually used in production; (d) grep for wide union types in TypeScript (`string | null`, `string | undefined`, domain enums widened to `string`) that the app narrows at runtime.

**Why it matters**: every schema concession is a place where a future refactor can silently re-introduce a bug class — the 5b class was the persona-snowflake bug that shipped undetected for 4 months.

**Why out of scope of Identity Epic**: audit doesn't have a single unifying theme — it's a discovery pass that will spawn multiple independent fix PRs. Best done as its own mini-epic after Phase 6 integration tests land (so we can lean on those tests when tightening invariants).

**Start**: `prisma/schema.prisma` — enumerate every `?` on non-timestamp columns, cross-reference with `.findUnique` usage sites to identify which nullable values are never null at rest.

**Audit run 2026-05-21**: discovery pass executed. Phase 5b had already eliminated the largest class of nullable-that-isn't (the original `default_persona_id` case + the shell-user pattern). Remaining findings filed to `backlog/deferred.md` are narrow: (1) stale doc claim in `syncTables.ts:246` calling `default_llm_config_id` NOT NULL when it's actually nullable; (2) opportunity to tighten `users.default_llm_config_id` + `default_tts_config_id` to NOT NULL post-Phase-5b (no bug today, dead-code removal in resolvers). The bulk of the optional columns (description fields, error messages, voice/avatar data, override columns, state-machine columns like ExportJob.fileContent) are genuinely optional — null carries meaningful application state. Theme stays open for opportunistic future findings.

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

#### 🏗️ Knowledge vs Memory Distinction

Distinguish user-specific memories from personality-wide knowledge (lore, backstory, reference material). Add `type`/`scope` fields, support personality-wide knowledge items not filtered by userId. See [`docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md`](../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) for the full proposal (concepts valid, implementation TBD; originally drafted under the pgvector architecture).

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

### Theme: Provider Prompt Caching (cost-reduction epic)

_Focus: restructure prompt assembly so the prefix is stable enough to benefit from provider-side prompt caching (OpenRouter, z.ai, Anthropic-direct), without sacrificing freshness. Target: meaningful cost reduction on multi-turn conversations within the cache TTL window._

Currently we deliberately _break_ caching with a `<request_id>` token in the system prompt at `services/ai-worker/src/services/PromptBuilder.ts:231`, added in commit `6bbb25c08` (cross-turn duplication detection epic) on the theory it would help suppress free-model repetition. The hypothesis behind the buster is shaky — provider prefix caching only changes billing, not stochastic sampling, so adding nondeterminism to the prefix shouldn't influence output behavior either way. **First phase verifies and removes if confirmed.**

#### Current architecture (relevant for caching design)

- **System prompt**: one large XML block built by `PromptBuilder.buildFullSystemPrompt()` at line 182 — identity, constraints, datetime, location, request_id, participants, memory archive (RAG), references, `<chat_log>` (full history), protocol/tail.
- **Messages array**: `[systemPrompt, currentMessage]` only. History lives _inside_ the system prompt, not as separate turns. `services/ai-worker/src/services/ConversationalRAGService.ts:164`.
- **Provider routing**: OpenRouter for most models (Anthropic, OpenAI, Gemini, GLM, DeepSeek), direct z.ai for some GLM. `ChatOpenAI` (LangChain) → custom OpenRouter fetch wrapper at `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts`.
- **Reasoning models**: `LLMInvoker.transformMessagesForReasoningModel` rewrites system→user — caching strategy must survive this.

#### Why placement matters less than prefix stability

Cache hits depend on the longest stable prefix between requests, regardless of system-vs-messages split. Three things invalidate the prefix today:

1. The deliberate `<request_id>` cache-breaker (line 231).
2. Growing `<chat_log>` in the system prompt (every new turn = new system prompt).
3. Per-turn RAG memory results inserted before the chat log.

#### Caching mechanics by provider

- **Anthropic on OpenRouter**: explicit `cache_control: { type: 'ephemeral' }` markers, 5-min TTL, ~25% cache-write premium. Best ROI for multi-turn conversations <5 min between turns.
- **OpenAI on OpenRouter**: automatic prefix caching for prompts >1024 tokens.
- **Gemini**: automatic context caching exposed via OpenRouter.
- **DeepSeek**: automatic prefix caching.
- **z.ai (GLM)**: needs investigation — caching support exists but mechanics on OpenRouter passthrough vs direct API differ; check whether the z.ai coding plan exposes the same surface.

#### Fix shape (multi-PR epic)

**Phase 1: Verify and remove the cache-breaker**

- Confirm via experimentation: does removing `<request_id>` cause measurable repetition on free models? Hypothesis: no, since prefix caching doesn't influence stochastic sampling.
- If repetition genuinely returned, root-cause via temperature / repetition_penalty rather than reintroducing a useless buster.

**Phase 2: Restructure prompt into stability tiers**

- **Stable** (cache target): persona identity, constraints, base instructions, protocol section. Move into a dedicated section that excludes datetime/RAG/history.
- **Conversation history**: extract `<chat_log>` from the system prompt into proper `messages` array entries (per-turn user/assistant alternation). Each completed turn becomes a frozen prefix the next turn can cache against.
- **Volatile** (cannot cache): current user message, RAG memory archive, datetime, references. Keep in the current turn only.

**Phase 3: Provider-aware `cache_control` insertion**

- For Anthropic routes: insert `cache_control: { type: 'ephemeral' }` at the end of the stable prefix and on the last completed turn in the messages array.
- For other providers: rely on automatic prefix caching once the prefix is stabilized.
- Investigate z.ai-direct caching docs and parity with the OpenRouter passthrough.

**Phase 4: Reasoning-model handling**

- `LLMInvoker.transformMessagesForReasoningModel` rewrites system→user — cache breakpoints must follow the transformation. Either move cache markers post-transform or design the stable section to survive the rewrite intact.

**Phase 5: Measurement**

- Add cache-hit telemetry (`{ providerCacheHit, cacheReadTokens, cacheWriteTokens }`) on every LLM completion. Without this we can't tell if the restructuring actually paid off.
- Cost-comparison: aggregate billing per-persona before/after across one bake-in week.

#### Risks

- **Cold-start cost per persona**: each persona needs its own warm cache; rarely-active personas pay the cache-write premium without recouping it. Net negative for low-traffic personas — design needs to handle the asymmetry.
- **Prefix-mismatch noise**: subtle whitespace or ordering changes between turns silently produce cache misses. Need diff-checking telemetry to detect.
- **Multi-replica architecture**: caching is provider-side (not per-replica), so this is fine — but worth confirming the provider key includes nothing replica-specific.

#### Out of scope (deliberately)

- Switching providers — caching epic is provider-agnostic restructuring.
- Memory-archive caching — RAG results change per query, inherently uncacheable.

#### Start

- `services/ai-worker/src/services/PromptBuilder.ts:182-310` — `buildFullSystemPrompt`, central restructure target.
- `services/ai-worker/src/services/PromptBuilder.ts:231` — `<request_id>` buster, first thing to verify-and-remove.
- `services/ai-worker/src/services/ConversationalRAGService.ts:164` — message array assembly point.
- `services/ai-worker/src/services/LLMInvoker.ts` `transformMessagesForReasoningModel` — reasoning-model rewrite path.
- `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts` — provider request-shape entrypoint where `cache_control` markers would land for Anthropic routes.
- Original cache-breaker commit: `6bbb25c08 feat(ai-worker): cross-turn duplication detection with retry`.

Surfaced 2026-05-07 during user-driven intake — recalled from earlier thinking.

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

### Theme: Observability & Telemetry

_Logging quality, structured telemetry, and analytics. Codebase-wide decisions on retry counts, timeouts, cache TTLs, and feature adoption currently rely on guesswork. Vision-pipeline telemetry (2026-04-14) was the prototype; the rest extends that pattern. **Approach: Pino + structured logs + Railway query DSL is sufficient at one-person-project scale; not standing up Prometheus/Datadog/OTel.**_

#### ✨ Telemetry Strategy — Decision-Triggering Metrics

System-health decisions are made without quantitative data. Establish a structured-log convention so any tuning question can be answered by a Railway query rather than a guess.

- Audit current logging across services, identify gap events (hot-path successes with `durationMs`, cache hit/miss rates, job durations, queue depths, retry success rates per category)
- Standardize `{ durationMs, attempt, errorCategory, ...dimensionX }` structured-log shape (vision-pipeline retry logs are the prototype)
- Document Railway query cookbook (builds on `pnpm ops logs --filter` DSL passthrough)
- Define "decision-triggering metrics" — events that, when queried, answer a specific tuning question

#### ✨ User Analytics Strategy

No systematic view of product usage. Unanswerable today: which personalities have active users? Are users adopting `/browse` or falling back to `/list`? Does voice-engine adoption correlate with specific personalities? Retention by user cohort?

- **Event taxonomy**: command invocations, personality switches, voice/vision/memory usage, user-facing errors (as product signals, not debug signals)
- **Privacy constraints**: opaque user IDs only — never usernames, message content, or PII. Anything requiring message-content inspection is a non-starter
- **Build-vs-buy** (first decision point for this sub-epic):
  - **PostHog self-hosted on Railway** (open-source, product-analytics-native, server-side ingestion, self-hostable). Leading candidate
  - Plausible: too web-page-centric for a Discord bot
  - Custom Postgres event table + query UI: most control, heaviest ops burden
- Integration surface: event emission as middleware/hooks in command handlers and job processors, decoupled from business logic

#### 🐛 Lie-on-Error Fallback Audit (api-gateway category sweep)

Pattern surfaced by PR #881: the old `GET /user/timezone` handler returned `{ timezone: 'UTC', isDefault: true }` when the user row didn't exist (Phase 5c correctly replaced it with a 404). Architecturally correct but points at a broader category — endpoints that silently degrade to defaults on state errors mask real bugs.

**Audit scope**: grep api-gateway for `|| 'default'`, `?? defaults`, `if (user === null) return success-with-fallback` patterns. Any endpoint returning "plausible but fake" success where the real answer is "this doesn't exist" is a candidate.

**Fix shape per site**: flip to proper error (404/400/409) and surface the "fake success" path in logs so consumers (bot-client graceful-degradation logic) can adapt.

**Start**: `services/api-gateway/src/routes/user/**` first; then admin, shapes, persona routes.

#### 🐛 Error Serialization Audit

`err` sometimes serializes as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`, making logs useless for debugging. Goal: every `{ err: ... }` log shows message + stack.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Audit Node `undici` fetch errors — `TypeError` from `fetch()` serializes as `raw: "{}"` in Pino (non-enumerable properties). Seen in `GatewayClient.submitJob()` and `PersonalityMessageHandler` on Railway dev (2026-02-15)
- [ ] Review `normalizeErrorForLogging()` in `retry.ts`
- [ ] Review `determineErrorType()` in `logger.ts` (`constructor.name` check)
- [ ] Codebase-wide scan for `{ err: ... }` patterns producing useless output

#### 🐛 Inadequate LLM Response Detection

Compound scoring heuristic to detect garbage 200 OK responses (glm-5 returned just `"N"`, 1 token, `finishReason: "unknown"`, 160s). All signals already collected by `DiagnosticCollector`; timing data needs threading through `RAGResponse`. Integrates into PR #702's retry loop via `FallbackResponse` ranking.

**Signals**: `finishReason` unknown/error (+0.4), `completionTokens` ≤1/≤5 (+0.3/+0.15), no stop sequence + short (+0.2), extreme ms-per-token (+0.2), empty content (+0.3). Threshold: ≥0.5. Max 1 content retry.

**Files**: `ConversationalRAGTypes.ts` (add timing field), `ConversationalRAGService.ts` (thread timing), `RetryDecisionHelper.ts` or new scorer, `GenerationStep.ts` (call scorer), tests.

**Reference**: `debug/debug-compact-736e6c99-*.json`

#### 🏗️ Per-Attempt Diagnostic Tracking in Retry Loop

When the fallback response path is used (PR #672), the diagnostic payload mixes data from attempt 1 (token counts, model, raw content) with `llmInvocationMs: undefined` because timing was reset for attempt 2. Add a `diagnosticAttempt` field or per-attempt timing array so the payload is internally consistent.

#### 🏗️ Audit Error Sanitization in Log Pipeline

Two gaps: (1) Enumerable Error properties (e.g. Axios `error.config.url`) bypass `sanitizeObject()` early-return for `instanceof Error`. (2) `getErrorContext` callback results spread into log objects without sanitization. Check OpenRouter/LangChain error objects, document API contract. Discovered during PR #700.

#### 🧹 Logging Hygiene

Two related cleanups:

- **Verbosity audit**: demote routine `logger.info()` calls to DEBUG; reserve ERROR/WARN for actionable items; review hot paths (message processing, cache lookups) for excessive logging
- **Service prefix injection**: extend Pino logger factory to auto-add service name as a structured `service` field instead of hardcoded `[ServiceName]` strings in messages

#### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped); remaining: admin error responses include stack traces and internal context, user-facing errors show friendly messages without internals.

---

### Theme: Tooling & Quality Ratchet

_Developer experience, schema-type discipline, CI strictness, and test infrastructure that keeps the codebase healthy as it grows._

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [x] **CPD**: ratchet shipped 2026-05-16 as `pnpm ops cpd:check` (CI lint job) + post-filter heuristic + boundary docs. See `docs/reference/CPD_CAMPAIGN_AUDIT.md` for the close-out audit and `02-code-standards.md` "Duplication, Helpers, and the CPD Ratchet" for the rules.
- [x] **Duplicate Exports**: `guard:duplicate-exports` already runs blocking in CI (no `continue-on-error`) and pre-push, with an `ALLOWLIST` mechanism in `packages/tooling/src/dev/check-duplicate-exports.ts` for intentional duplicates. Currently 0 violations across all packages. Ratchet effectively in place — the "baseline file" approach is unnecessary because the allowlist serves the same role and is more readable.
- [x] **ESLint warnings**: `eslint --max-warnings=0` is set on every package's lint script, so `complexity`, `max-statements`, `max-lines-per-function`, `max-depth`, `max-params`, `max-nested-callbacks`, and `sonarjs/cognitive-complexity` (all warn-level rules) effectively block CI. `pnpm lint` is currently clean (0 warnings of any kind). No baseline needed — the codebase is already at zero.
- [x] **Knip dead-files**: shipped 2026-05-17 — `pnpm knip:dead` now blocks in both the pre-push hook and the CI lint job. `pnpm knip` (unused exports/imports/deps) was already CI-blocking. Goal achieved: dead files surface immediately, not by audit cycle. The unused-exports half (`pnpm knip`) has been CI-blocking for a while; this closes the dead-files half.

**Theme status: CLOSED.** All four planned ratchets are in place. Future "block more warnings" work would go in a fresh theme; this one is complete.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Each job type currently has both a Zod schema and a hand-written TypeScript interface kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🏗️ API Gateway Middleware Wiring Integration Tests

Add supertest-style integration tests that boot the actual Express app with real middleware. Verifies auth middleware is correctly applied (factory functions called, not just passed), routes respond properly, error middleware works. Audit `router.use(...)` calls for missing `()` on factory functions. Discovered during PR #691.

#### 🏗️ Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate: dev-only auto-migration in start command, pre-deploy hook with `prisma migrate deploy`, CI step that validates migration state matches schema.

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns (e.g., capability flags, context-window limits) to database for admin updates without deployment.

#### 🧹 Ops CLI Command Migration

Migrate remaining stub commands in `packages/tooling` to proper TypeScript implementations.

### Theme: `/voice` + `/inspect` UX Polish (mini-epic)

_Focus: the `/voice` and `/inspect` surfaces accumulated UX rough edges during the TTS Phase 3 cutover. Group them to amortize the test-harness + integration-snapshot regen cost._

Surfaced 2026-05-11 from user dev-verification feedback on beta.120 deployment.

1. **`/voice view <character>` reads as global, not character-scoped** — User: "it asks me to pick a character but then I get this view." Four layered problems on the same embed: (a) title is generic `🎙️ Voice Settings` not `Voice Settings for [CharacterName]`; (b) cascade source labels ("your TTS default", "your transcription preference") describe tier but don't communicate "this is the resolved value FOR THIS CHARACTER"; (c) the "Cloned Voices" section is user-scoped (your full library, 40 entries), nothing to do with the picked character — creates false implication of association; (d) the footer is the only character-scoping clue. **Fix**: (1) title `🎙️ Voice Settings for **${characterName}**`; (2) annotate each setting line with character-specific vs fell-through-to-default; (3) drop Cloned Voices section here entirely (move to `/voice library` or bundle with item 2 below); (4) drop or rewrite footer. ~50-100 LOC in `commands/voice/view.ts`.

2. **`/voice voices browse` UX overhaul: rename + interactive select menu** — User: "kinda clunky - both the naming scheme and the fact that you can't interact with any of the voices like we usually can with browse commands." Two interlocking problems: (a) naming stutters ("voice voices") AND `browse` is list-mine semantic (same class as PR #1020's `browse → list`); should likely become `/voice voices list` OR collapse the doubled noun (e.g., `/voice library list`); (b) no select menu on the paginated list — user has to type voice names verbatim into a separate `/voice voices delete <voice>`. `/character browse` is the codebase's reference pattern. **Fix**: rename + replicate `/character browse` pattern (select menu → detail view with `▶ Preview`, `🗑 Delete`, `Back to List`). ~150-300 LOC across browse handler + new detail handler + tests + customId routing.

3. **`/inspect` STT/TTS attribution buried under Token Budget view** — User: "I don't love that the STT/TTS stuff is buried under token explorer or whatever. that's very unintuitive." TTS attribution + any STT attribution lives in `buildTokenBudgetView`, semantically about prompt-token consumption — not voice-pipeline routing. **Fix**: extract voice attribution into `buildVoiceAttributionView` rendering `sttProviderUsed` + `ttsProviderUsed` with fallback annotations, add select-menu entry to inspect dropdown. Consider including transcript content + audio key + duration. ~80-150 LOC.

4. **`/inspect` views: inline-render small content instead of always file-attaching** — Several `/inspect` panel views unconditionally emit content as downloadable file (e.g., reasoning trace) even when it would fit in an ephemeral message body or embed description. Friction for the small-content case. **Fix**: in each affected view builder, check content length; render inline (embed description or message body) when under threshold (~4096 for embed desc, ~2000 for message), fall back to file when over. Affected: at least `buildReasoningView`; audit others in `services/bot-client/src/commands/inspect/views.ts`. ~50-100 LOC.

5. **Diagnostic surface for "context dropped because X" pipeline decisions** — Connects to user's 2026-05-03 `Found: 20 / Included: 0` note. Pipeline stages currently make silent skip/drop decisions; the LLM Diagnostic Summary surfaces final counts but not the _why_ of intermediate drops. **Fix**: each pipeline stage that drops/skips emits a structured "decision" entry (stage + count + reason) into the diagnostic payload; Diagnostic Summary renders as a "Drops" section. ~80-150 LOC across pipeline + diagnostic UI.

**Sequencing**: items 1 + 2 together (both touch voice-library presentation surface). Items 3 + 4 together (both touch `/inspect` views). Item 5 separately (depth-of-pipeline change, deserves its own design).

**Promote when**: next `/voice` or `/inspect` UX pass, OR if the friction comes up again. Promoted from Inbox 2026-05-12.

### Theme: Self-Hosted TTS + BYOK Re-Evaluation (NeuTTS Air abandoned 2026-05-13)

_Focus: NeuTTS Air was the planned Phase 2 self-hosted voice-cloning engine but was abandoned after a hands-on probe revealed architectural mismatch. Need to evaluate replacement candidates AND reassess Mistral BYOK quality._

**NeuTTS Air abandon evidence (2026-05-13 probe + research)**:

- README spec: "Context Window: 2048 tokens, enough for processing ~30 seconds of audio" — hard cap incompatible with our 1-4 min long-form use case
- Hands-on Railway probe (Sapphire Rapids Xeon 8581C, 16 cores): RTF 12-21x on completed inferences; outputs truncate well below requested length
- GitHub issue [#41](https://github.com/neuphonic/neutts/issues/41): user on i9-9900K + RTX 2080 Ti reports RTF 4 — far worse than published "real-time" claims
- GitHub issue [#62](https://github.com/neuphonic/neutts/issues/62): open feature request for chunked long-form support, no maintainer response in 7 months
- GitHub issues [#15, #22](https://github.com/neuphonic/neutts/issues): output truncation reports, no maintainer responses
- Pattern: maintainer team essentially unresponsive on quality/performance issues

User feedback 2026-05-12: "Mistral still kinda sucks. after NeuTTS I may want to look into a better provider (again)."

User feedback 2026-05-13 (post-NeuTTS-abandon): both self-hosted (Pocket TTS) AND BYOK (Mistral) are below the quality bar. Pocket TTS has had at least one user complaint plus owner's own underwhelmed assessment. Tomorrow's priority: revisit BOTH tracks together — the goal isn't "find a NeuTTS replacement," it's "raise the quality floor on both self-hosted and BYOK paths."

**Update 2026-05-13 (exhaustive CPU probe completed)**: After hands-on probing of NeuTTS Air, XTTS v2, SoproTTS, MOSS-TTS-Nano, and ZipVoice (with desk research on F5-TTS, OmniVoice, CosyVoice), the conclusion is **CPU-only + voice-cloning + acceptable-quality is structurally unachievable** in current open source. Pocket TTS turns out to be the uniquely best CPU-cloning option, not by luck but by virtue of kyutai-labs's engineering maturity. The free-tier ceiling is therefore Pocket TTS as-is; meaningful self-hosted quality improvement would require GPU compute (separate decision — Modal/RunPod/Replicate for voice-engine).

**Update 2026-05-13 (Mistral guardrail evidence)**: Production logs revealed Mistral content-filtering innocuous humor (e.g., Monty Python references) with `code 1920 guardrail_violation`, silently degrading to self-hosted. Beyond a fix for visibility (see inbox), this is concrete evidence Mistral's content policy is too restrictive for our user base's irreverent personalities. Raises priority of BYOK re-eval.

**Pivot plan (next session)**: skip more CPU-engine probes; tackle the BYOK side directly. BYOK probes are fast (API calls, no install dances). **Step 0 — research pass first**: the candidate landscape is broader than the initial list captured here, and pricing has to be a primary filter (ElevenLabs was canceled 2026-05-08 specifically because it was too expensive — same constraint applies to candidate selection). Surface ALL viable BYOK voice-cloning options with current pricing, then probe the survivors.

**Candidates known (non-exhaustive):**

- **Cartesia Sonic** — low-latency, good cloning fidelity, less restrictive content policy
- **Fish Audio** — voice cloning, fast inference, competitive pricing (per user 2026-05-13)
- **PlayHT** — multiple model tiers, voice cloning
- **Resemble AI** — voice cloning, pricing unclear (verify)

**Hard out:**

- **ElevenLabs (any tier)** — per-character pricing too high; subscription canceled 2026-05-08

**Worth a research-pass scan** before bake-off:

- Rime.ai, Murf.ai, Sesame.AI (CSM), Deepgram TTS (newer), and any 2025–2026 entrants. Cloud TTS (Google/Azure/AWS) typically requires custom-voice training rather than zero-shot reference clips, so probably out unless our flow can absorb that.

Same probe pattern as self-hosted, but with API requests instead of local inference. Listen-test against the existing emily / lila / lilith reference + same test text for direct A/B with Mistral output. Pricing-per-1K-chars (or per-minute-of-output) needs to be in the comparison table alongside quality.

**Required: Step 0 — hands-on probe before promoting any candidate to plan-mode** (lesson learned from NeuTTS Air decision-without-probe). The probe pattern that worked well: SSH dev voice-engine, install candidate in `/tmp` venv, run a 20-line bench script that loads model + synthesizes 5-30s of output + measures elapsed time + RAM peak. Total 30 min, no PR. Decision criteria: RTF < 3.0 OR (constant-time pattern that yields acceptable per-request synth time at the user's actual desired output lengths) AND subjectively-better-than-Pocket-TTS quality. The 2026-05-13 NeuTTS Air probe scripts are a reusable template.

**Candidates re-evaluated 2026-05-14** (council brainstorm via Gemini 3.1 Pro Preview, after dropping the Pocket TTS post-processing sub-track):

- **F5-TTS** — **DROPPED 2026-05-14 after hands-on probe**. License: code MIT, weights CC-BY-NC (OK for our non-commercial use). Council estimated vanilla CPU RTF ~1.5 reducible to ~0.5-0.8 via ONNX + step reduction + thread limiting. Probe results on Sapphire Rapids 8581C with `f5-tts` from PyPI:
  - **RTF 1.94** at NFE=4 / 32 threads (best speed config). User quality verdict: **"barely any audible word output. mostly weird hissing and artifacting"** — flow-matching diffusion didn't converge enough at NFE=4 to produce coherent speech.
  - **RTF 3.58** at NFE=8 / 32 threads (council's recommended speedup). Not user-tested at this NFE because the speed was already unworkable.
  - Council's thread-thrashing hypothesis was **falsified for this workload** — fewer threads made RTF monotonically WORSE (NFE=4 hit RTF 2.74 at 8 threads, 3.69 at 4 threads).

  **The structural problem**: at the NFE level F5-TTS needs to produce coherent output (≥8), CPU RTF is unworkable; at the NFE level CPU can sustain (4), the flow-matching diffusion collapses into hiss. There is no NFE setting where this works on CPU. ONNX optimization (DakeQQ port) might close 2-3x of speed but can't move the NFE quality cliff. Closed.

  **Reusable lesson — don't probe below the quality cliff "to see speed numbers"**: when reducing iteration count on diffusion or flow-matching models, there's a hard quality cliff below some threshold (~NFE=6-8 for most modern flow models, model-dependent) that's separate from the gradual degradation above it. Always test quality at the recommended NFE first, THEN ask whether the resulting speed is survivable. Going under the recommended NFE because the speed is unworkable is a category error — the speed is meaningless if the output isn't speech.

- **k2-fsa/OmniVoice** — **RULE OUT** (desk research only). Sherpa-ONNX makes it blazingly fast on CPU but the underlying VITS-based architecture has the same baked-in "machine-y" cadence as Pocket TTS. Lateral move on the actual user complaint, not improvement.
- **CosyVoice 2.0** (Alibaba) — **RULE OUT** (desk research only). CPU RTF >1.5-3.0 in community benchmarks, heavily CUDA-optimized. Would choke the Railway container without a complete inference rewrite (C++/ONNX), and even then it's heavy.

**Verdict 2026-05-14**: CPU-only voice cloning is **comprehensively, empirically exhausted** across seven distinct intervention angles. Eight engines tested (NeuTTS Air, XTTS v2, SoproTTS, MOSS-TTS-Nano, ZipVoice, OpenVoice V2 TCC, F5-TTS hands-on; OmniVoice and CosyVoice desk-research). Pocket TTS remains the local optimum, and on top of the engine-swap evidence we now have: (a) Pocket TTS hyperparameter sweep — no effect; (b) reference cleaning via resemble-enhance — no meaningful change; (c) period-prefix workaround — no effect; (d) multi-pass generation (8 takes) — best take still "sucks slightly less" per user. **Diagnostic root cause** (user observation 2026-05-14): Pocket TTS doesn't model pitch dynamics well — when reference voices have expressive pitch variation in short timespans (e.g., animated voice acting), the synthesis can't reproduce it cleanly. This is the same Iron Triangle constraint expressed at finer resolution: the architecture sacrificed expressive prosody for speed and cloning, and that's the binding ceiling.

**The "Iron Triangle" worth filing** for any future TTS evaluation — pick two of: CPU efficiency, zero-shot cloning, ElevenLabs-tier prosody. Pocket TTS picked efficiency + cloning. F5-TTS picks cloning + prosody. There's no engine that wins all three on commodity CPU; this is architectural, not implementation laziness.

**Reusable probe insights** (apply to any future CPU TTS candidate — preserved even though CPU path is closed, since they apply if GPU-compute decision changes the equation):

1. **TTFB > RTF for Discord** — RTF 0.8 is invisible to users if you stream sentence-chunked output (first sentence plays while sentences 2-N synthesize in parallel).
2. **Long-form (1-4 min) requires semantic chunking with last-3s carry-forward as new reference**. NO modern zero-shot model handles 4 min in one forward pass without hallucinating; this is universal.
3. **Sapphire Rapids (Xeon 8581C) has AMX + AVX-512** — ONNX/OpenVINO compile path _can_ beat naive CPU PyTorch on this hardware, but the F5-TTS probe revealed it's not a free 3-4x speedup; it's its own engineering effort.
4. **Thread thrashing is workload-dependent.** Council's prior was "don't use all 32 vCPUs"; F5-TTS contradicted this — fewer threads monotonically slower. Always sweep, don't assume.

**Status of other un-probed angles** (per 2026-05-14 honest exhaustion check):

- **Pocket TTS hyperparameter tuning** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Knobs found in the `pocket_tts` package: `lsd_decode_steps` (default 1, the absolute minimum — analogous to NFE in flow matching), `temp` (default 0.7), `noise_clamp`, `eos_threshold`. Pocket TTS is FlowNet2 — same architectural family as F5-TTS. Hypothesis: bumping `lsd_decode_steps` from 1 (default minimum) up to 2/4/8 might dramatically improve quality, since flow-matching models typically need many denoising steps. Probed both ha-shem and emily references at lsd=1/2/4/8 plus temp=0.5/0.7/0.9 at lsd=4 (12 variants total, all level-matched -14 LUFS for fair A/B). User verdict on both reference voices: "I can barely discern any difference" / "they all sound bad to me." Speed measurements: lsd=1→8 takes RTF from 0.50 → 0.86 (linear scaling with iterations), so the knob ALSO has a real cost. **Conclusion**: unlike F5-TTS (which needs many NFE steps to converge), Pocket TTS appears to be heavily distilled — its 1-step output IS the converged output for this architecture. The "machine-y" quality is baked into the model itself, not a tunable parameter. **`lsd_decode_steps` is a measurable speed knob with no quality impact for this distilled model — don't probe again.**
- **Other voice conversion engines** (FreeVC, KNN-VC, SoftVC, RVC) — same dead end as TCC. VC fixes timbre, complaint is prosody/fidelity. Skip.
- **Multi-pass generation + selection** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Pocket TTS IS stochastic — output durations varied 17.04s → 19.36s across 8 takes of identical input. But user verdict on best-of-8 emily takes (full-enhanced reference): "they all kinda suck but I guess #7 sucks slightly less." Even hand-curated best-of-8 (best-case offline scenario, perfect human selection) doesn't clear the quality bar. Automated selection couldn't possibly do better. Productionization story was already weak (no cheap automated MOS scorer that knows "this take handles pitch better than that one"); the empirical finding makes it moot anyway. The model's ceiling, not its stochastic distribution, is what's binding.
- **Reference cleaning (resemble-enhance)** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Probed both denoise-only and full-enhancement modes on emily (Hazbin Hotel YouTube source) and ha-shem (Matrix oracle clip) refs, then fed cleaned refs through Pocket TTS. User verdict: not enough difference to easily tell. The references were already clean (movie/TV audio, not Discord-quality compressed), so the maintainer's "Pocket TTS reproduces acoustic conditions of the reference" mechanism didn't have noisy input to clean up. Resemble-enhance install gotcha: needs `git` on the container for model download (use HF `snapshot_download` to bypass) and outputs 32-bit float WAV that pocket_tts's `wave` module can't read (convert via ffmpeg `-c:a pcm_s16le`). Process: `pip install resemble-enhance`, then `resemble-enhance --device cpu [--denoise_only] in_dir out_dir`. CPU RTF: ~0.5 for denoise-only, ~6 for full enhancement.
- **Period-prefix workaround** (community fix from `kyutai-labs/pocket-tts` issue #91 — "first word garbled, smeared, or a tad deranged") — **EMPIRICALLY EXHAUSTED 2026-05-14**. Tested as part of the cleaned-refs sweep. No meaningful difference in user A/B. Either our refs already end at word boundaries (avoiding the issue), or our test text doesn't trigger the artifact strongly enough.
- **GPU-compute for voice-engine** (Modal / RunPod / Replicate / Banana / Fly.io GPU) — **the only remaining lever** to break the Iron Triangle's CPU constraint. Cost-per-request becomes a real concern (vs Railway CPU's $0.005/cold-start ballpark); ~$0.01-0.05/request typical for managed GPU inference services. Decision needs separate research and product judgment about user volume + willingness-to-pay-via-tier. Filing as the "next theme to consider" if BYOK quality-shopping also fails to satisfy.

**Sequence (revised after F5-TTS dropped)**:

1. **BYOK quality-shopping** is now the only forward path on the quality axis: Cartesia, Fish Audio, PlayHT, Resemble. API-call probes are fast and independent of any self-hosted work. See "Pivot plan" above.
2. **If BYOK doesn't satisfy** — decide whether to invest in GPU-hosted voice-engine (separate research theme, see status list above).
3. **Pocket TTS stays** as the free-tier self-hosted engine. Quality is what it is; that's the cost of free.

**Evaluation axes**: quality (subjective + reference-listener), model size + GPU requirements (for self-hosted candidates), license, voice-cloning fidelity, latency, cost (for BYOK candidates), reference-audio constraints (Mistral's 30s cap is a real limitation).

**Promote when**: BYOK quality-shopping headspace returns. Promoted from Inbox 2026-05-12.

---

#### Sub-track: Pocket TTS post-processing chain — DROPPED 2026-05-14

Probed two complementary post-processing approaches; both ruled out. Documenting rationale so future quality work doesn't re-tread the same ground.

**(B) ffmpeg DSP chain** — probed 2026-05-13/14 with conservative (HP80 + compress + LUFS-norm) and aggressive (+ presence + de-ess) variants. Level-matched A/B verdict: "very similar" to raw + LUFS-norm baseline. **Verdict: not worth shipping standalone.**

**(C) OpenVoice V2 Tone Color Converter** — voice-conversion layer probed 2026-05-14. Install gotchas worth preserving for any future VC probe: container has no `git` (use tarball download), `se_extractor` module hardcodes `device="cuda"` AND pulls heavy whisper deps (PyAV needs system `pkg-config`) — bypass entirely by using the built-in `ToneColorConverter.extract_se()` method on the class itself. Minimal deps: torch, numpy, soundfile, librosa, inflect, unidecode, eng_to_ipa, pypinyin, cn2an, jieba, langid, wavmark, psutil. Two test runs:

1. **emily reference** (initial probe): RTF 0.218 ✅, output not truncated, peak RAM 1270 MB. Subjective verdict: pitch shift toward emily's higher F0 — register mismatch artifact. Tau sweep (0.1, 0.3, 0.5, 0.8) showed pitch shift is tau-independent → not a tunable knob.
2. **ha-shem-keev-ima reference** (hypothesis test): RTF 0.248 ✅, pitch shift gone (confirming register-mismatch hypothesis). Subjective verdict: "mixed bag — some moments cleaner, others noisier; feels like grasping for clarity but inconsistent in artifact presence."

**Why dropped**: A "mixed" win doesn't justify the complexity (10+ transitive deps, wavmark watermark dep is unmaintained, per-character behavior is reference-dependent so a per-personality `vc_postprocess` toggle UX would be needed). And — decisively — the user's underlying complaint about Pocket TTS quality isn't _timbre_ (TCC's domain), it's something closer to prosody/naturalness/fidelity that VC structurally cannot reach. Council's earlier framing — "VC fixes timbre, not prosody" — proved load-bearing.

**Honest forward path**: BYOK quality-shopping (Cartesia, Fish Audio, PlayHT) is the right axis. CPU-only voice cloning has a hard ceiling that no amount of post-processing crosses.

**Reusable probe pattern** (the scratch script was deleted per scripts/-is-for-one-offs rule, but worth preserving the shape for future voice probes that need a real reference clip):

```ts
// pnpm ops run --env prod npx tsx scripts/src/db/fetch-voice-ref.ts <slug> <out>
import { writeFileSync } from 'node:fs';
import { getPrismaClient } from '@tzurot/common-types';
const [, , slug, out] = process.argv;
const prisma = getPrismaClient();
const p = await prisma.personality.findFirst({
  where: { slug },
  select: { voiceReferenceData: true, displayName: true },
});
if (!p?.voiceReferenceData) throw new Error(`no ref for ${slug}`);
writeFileSync(out, p.voiceReferenceData);
console.log(`wrote ${p.voiceReferenceData.length} bytes (${p.displayName})`);
await prisma.$disconnect();
```

If we end up needing this 2+ more times, promote to `pnpm ops voice-refs:export <slug> <out>` rather than recreating the scratch.

**Reusable upload pattern** (railway ssh has no scp; argv length limit kills inline base64 for files >~500KB): `split -b 100000` the b64 into chunks, loop `printf '%s' "$chunk" >> /remote/file.b64` per chunk, decode on remote side. Verify with md5sum on both ends.

### Theme: Adjacent CPD Follow-Up Campaigns (deferred from 2026-05-16 campaign close-out)

_Focus: four distinct DRY-extraction campaigns that the api-gateway CRUD-config campaign explicitly LEFT for separate council passes. Each is independently scoped; none are bugs — all are opportunities surfaced and classified during the 2026-05-16 audit (see [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../docs/reference/CPD_CAMPAIGN_AUDIT.md))._

The campaign-close audit at `docs/reference/CPD_CAMPAIGN_AUDIT.md` classifies the remaining post-filter clones into four buckets. Three of those buckets are out-of-scope-by-design (deferred to future campaigns); one is in-file local-helper work. Picking these up individually:

1. **🟣 Service-layer parallel cleanup** (~24 lines / 2 clones)
   - `services/api-gateway/src/services/LlmConfigService.ts` ↔ `TtsConfigService.ts`
   - Sibling service implementations with shared structure (CRUD methods, scope-aware lookups, cache invalidation, error classes)
   - **Lowest blast radius** of the four. The helpers from PR #1039-1041 are at the ROUTE layer; this campaign would be the analogous extraction one level deeper. Some helpers may apply directly (`checkNameExists` is already parameterized).
   - Council pass should focus on: which divergences are caller-policy vs structural? Are `AutoSuffixCollisionError` ↔ `TtsAutoSuffixCollisionError` (LLM/TTS) and other error class pairs worth unifying with a discriminated-result type?

2. **🟡 api-gateway override-route campaign** (~49 lines / 4 clones between `model-override` ↔ `tts-override`, plus internal clones in `stt-override`, `voice-resolution`, `config-overrides`)
   - `services/api-gateway/src/routes/user/{tts,stt,model}-override.ts`
   - **Explicitly flagged as DIFFERENT shape than CRUD** by Kimi K2.6 and GLM 5.1 during 2026-05-16 council review. Cascade-override semantics set/clear values on a personality-scoped key; not row-based CRUD. Forcing CRUD helpers (`findConfigOrSendNotFound`, `ensureNoNameCollision`) here would be the Wrong Abstraction trap.
   - Boundary documented in `.claude/rules/02-code-standards.md` "Config Route Helpers" section.
   - Council pass should focus on: what's the cascade-override helper kernel? `mergeAndValidateOverrides` already exists in `configOverrideHelpers.ts` — what else generalizes?

3. **🟡 bot-client command-pattern campaign** (~221 lines / 11 clones — the largest cluster)
   - Top pairs: `character/overrides` ↔ `character/settings` (93 lines), `character/truncationWarning` ↔ `persona/truncationWarning` (88 lines), `commands/settings/preset/autocomplete` ↔ `commands/voice/tts/autocomplete` (38 + 27 lines)
   - Discord.js command paradigm. Different concerns than api-gateway routes (option-builder, interaction handlers, deferReply 3-second budget). Existing utilities in `services/bot-client/src/utils/` already cover some patterns (browse, dashboard, autocomplete) — incremental extraction continues that work.
   - **Largest remaining cluster** by lines, but most architecturally different from what was just done.
   - Council pass should focus on: which command groupings genuinely share helper-extractable shape? `character/*` siblings probably yes; `character/truncationWarning` ↔ `persona/truncationWarning` looks ripe.

4. **🟣 ai-worker service-pattern campaign** (~34 lines / 2 clones for voice-provider siblings, plus internal in `KeyValidationService`, `ElevenLabsClient`)
   - `services/ai-worker/src/services/voice/ElevenLabsVoiceService.ts` ↔ `voice/providers/MistralTtsProvider.ts`
   - Voice provider abstraction was deliberately additive during the TTS Phase 1+3 work — each provider implements `TtsProvider` independently. Cross-provider duplication has accumulated.
   - Council pass should focus on: is the `TtsProvider` interface incomplete? Should there be a `BaseTtsProvider` with shared concerns (cost telemetry, fallback wiring) and provider-specific subclasses for inference?

**Plus a non-campaign-shaped item:**

5. **🔵 In-file local-helper extraction sweep** — 10 file pairs from the audit are SAME-file internal clones (`user/history.ts` self, `user/memorySingle.ts` self, `SettingsDashboardHandler` self, `ElevenLabsClient` self, etc., totaling ~339 lines). These are repeated guards/loops within single handlers that local-helper extraction would clean up. Per-file work, not a campaign — surface for opportunistic cleanup when next touching each file.

**Sequencing**: Item 1 (service-layer) has the lowest blast radius and most immediate adjacency to what we just shipped — natural first pick. Item 2 (override-routes) is gated on a council design pass for the cascade-helper kernel shape. Item 3 (bot-client) is the largest but most architecturally distinct — would benefit from its own multi-PR shape. Item 4 (ai-worker voice providers) is the smallest and could be a single PR.

**Promote when**: capacity for another DRY-extraction campaign exists, OR opportunistically when next touching the relevant code. Each item gets its own council pass before plan-mode per the project's "consult council before major refactors" rule.

**Start**: read `docs/reference/CPD_CAMPAIGN_AUDIT.md` for the full pair-by-pair classification + `.claude/rules/02-code-standards.md` "Duplication, Helpers, and the CPD Ratchet" section for the 2-callback ceiling rule that governs all future extraction decisions.

### Theme: Slim `@tzurot/common-types` — extract non-type domains (PR-2n)

_Focus: common-types has drifted past "types" into a grab-bag. Post-clients-extraction it's still 137 files / 22.8k lines / 938 exports, including a `factories/` dir (test mock-builders) and a `services/` dir (stateful logic, e.g. `ConversationHistoryService` 588 lines). A types package shouldn't host either. Extract them so the shared surface is actually types/schemas/constants/utils._

**Appraisal (2026-06-03):** the 938-export barrel is *wide*, not *tangled* — 0 internal barrel cycles, modest cross-subdomain coupling (`services/→schemas/` 8 files). So the export count is breadth, not spaghetti. The real architectural drift is non-types (services, factories) living in a types package. Extracting them is higher-leverage than the barrel-kill (which is import hygiene — perf + boundaries — tracked separately in icebox).

**Phase 1 — `factories/ → @tzurot/test-utils` (IN PROGRESS 2026-06-03).** The 8 factory files are validated mock-builders consumed only by tests. Confirmed acyclic: test-utils has no common-types dep today and common-types doesn't depend on test-utils (build graph), so test-utils → common-types is clean one-way. Move the dir, add the common-types dep to test-utils, repoint ~20 test consumers from `@tzurot/common-types` → `@tzurot/test-utils`, drop the `export * from './factories'` barrel line. Low-risk opener; also shrinks the common-types surface before Phase 2.

**Phase 2 — extract `services/` (design-bearing).** `services/` holds stateful logic (`ConversationHistoryService`, etc.) consumed by ai-worker/api-gateway. Needs a design call: shared service package vs. moving each service into its primary consumer. Council pass recommended (mirrors the clients-extraction design loop). Bigger blast radius; do after Phase 1.

**Phase 3 (optional) — barrel-kill / exports-map.** See icebox; import hygiene, 1,021 sites, lowest urgency. Reassess after Phases 1–2 shrink the surface.
