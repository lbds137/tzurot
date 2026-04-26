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
