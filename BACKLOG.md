# Backlog

> **Last Updated**: 2026-02-12
> **Version**: v3.0.0-beta.71

Single source of truth for all work. Tech debt competes for the same time as features.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## 🚨 Production Issues

_Active bugs observed in production. Fix before new features._

_None currently._

---

## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

_Empty — triaged 2026-02-12._

---

## 🎯 Current Focus

_This week's active work. Max 3 items._

1. ✨ **Incognito `/character chat` Poke** — no memories, no active marking when no message attached
2. ✨ **Reply-to Context in Prompting** — include replied-to message context so AI knows what the user is replying to

---

## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### ✨ Bot Health Status

Admin command showing bot health and diagnostics.

- [ ] `/admin health` - Show uptime, version, connected services
- [ ] Include: Discord connection, Redis, PostgreSQL, BullMQ queue depth
- [ ] Optional: memory usage, active personality count

### ✨ Discord Emoji/Sticker Image Support

Support custom Discord emoji and stickers in vision context.

- [ ] Extract emoji URLs from message content (custom emoji format: `<:name:id>`)
- [ ] Extract sticker URLs from message stickers
- [ ] Include in vision context alongside attachments
- [ ] Handle animated emoji/stickers (GIF vs static)

### 🏗️ Eliminate Remaining ESLint Warnings (bot-client cognitive complexity only)

7 cognitive-complexity warnings remaining, all in bot-client. All other warning types fixed 2026-02-12. Bundle with bot-client package splitting effort.

Pre-commit hook uses `--max-warnings=0` but `pnpm lint` and CI do not — warnings pass in CI but fail on commit. Need to harmonize around the stricter rule.

- [x] Fix non-bot-client warnings (common-types, api-gateway, ai-worker) — done 2026-02-12
- [x] Fix bot-client `sonarjs/no-duplicate-string` warnings (extract constants) — done 2026-02-12
- [x] Fix remaining minor warnings (`no-redundant-jump`, `prefer-immediate-return`) — done 2026-02-12
- [ ] Fix bot-client `sonarjs/cognitive-complexity` warnings (extract helpers)
- [ ] Add `--max-warnings=0` to all package `lint` scripts in `package.json`
- [ ] Verify CI passes with stricter rule

### 🧹 Redis Failure Injection Tests

SessionManager has acknowledged gap in testing Redis failure scenarios. Add failure injection tests for graceful degradation verification.

### 🏗️ [LIFT] Extract Finish Reason String Constants

Hardcoded finish reason strings like `'length'` appear in `inspect/embed.ts` and potentially elsewhere. Extract to named constants in `common-types` (e.g., `FINISH_REASONS.LENGTH`, `FINISH_REASONS.STOP`).

### ✨ Admin/User Error Context Differentiation

Admin errors should show full technical context; user errors show sanitized version. Partially done in PR #587 (error display framework shipped), this is the remaining differentiation.

### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

---

## 🏗 Active Epic: Package Extraction

_Focus: Reduce common-types bloat and improve module boundaries._

common-types has 607 exports (12x the 50-export threshold). bot-client is 45.7K lines with 767 exports.

### Phase 1: Assessment

- [ ] Reassess common-types export count — if still >50, extract domain packages
- [ ] Identify highest-value extraction candidates
- [ ] Reference: PR #558 analysis

### Phase 2: Extraction

- [ ] Candidates: `@tzurot/discord-dashboard` (30 files, self-contained), `@tzurot/message-references` (12 files), `@tzurot/discord-command-context` (6 files)

**Previous work**: Architecture Health epic (PRs #593–#597) completed dead code purge, oversized file splits, 400-line max-lines limit, and circular dependency resolution (54→25, all remaining are generated Prisma code).

---

## 📅 Next Epic: _TBD — select from Future Themes when Package Extraction completes_

---

## 📦 Future Themes

_Epics ordered by dependency. Pick the next one when current epic completes._

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

---

### Theme: Character Portability

_Import and export characters and user data. Users own their data._

#### ✨ User Data Export

Unified export of all user-owned data. Currently preset export and character export exist but are separate.

- [ ] `/me export` command - download all user data as JSON/ZIP
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

#### 🏗️ Shapes.inc Import

Migration path from v2. Legacy data migration.

- [ ] Parse shapes.inc backup JSON format
- [ ] Import wizard slash command (`/character import --source shapes`)
- [ ] Map shapes.inc fields to v3 personality schema
- [ ] Handle avatar migration

---

### Theme: User-Requested Features

_Features requested by actual users. High value._

#### ✨ Multi-Personality Per Channel

Allow multiple personalities active in a single channel.

- [ ] Track multiple active personalities per channel
- [ ] Natural order speaker selection (who responds next)
- [ ] Handle @mentions when multiple personalities present
- [ ] `/channel add-personality` and `/channel remove-personality` commands

#### ✨ User System Prompts

"Sidecar prompt" appended to system message per-user.

- [ ] Add `systemPrompt` field to User or UserPersonalityConfig
- [ ] `/me profile` dashboard upgrade to edit system prompt

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

- **Voice Synthesis** - Open-source TTS/STT for voice interactions
- **Image Generation** - AI-generated images from personalities

---

### Theme: Error Observability Overhaul

_Comprehensive audit and fix of error serialization across the stack._

#### 🐛 Error Serialization Audit

During the GLM-5 empty response investigation, `err` serialized as `{_nonErrorObject: true, raw: "{}"}` despite being a real `Error`. Makes logs nearly useless for debugging provider issues.

- [ ] Audit LangChain throwing non-Error objects that look like Errors
- [ ] Review `normalizeErrorForLogging()` in `retry.ts` wrapping behavior
- [ ] Review `determineErrorType()` in `logger.ts` checking `constructor.name`
- [ ] Codebase-wide scan for `{ err: ... }` patterns that produce useless output
- [ ] Goal: every `{ err: ... }` log shows message + stack, never `raw: "{}"`

---

### Theme: Observability & Tooling

_Backend health: monitoring, debugging, developer experience._

#### ✨ Stop Sequence Stats Admin Command

Expose stop sequence activation stats via `/admin stats stop-sequences`.

- [ ] Store stats in Redis (ai-worker writes on each activation)
- [ ] Add gateway endpoint `GET /admin/stop-sequence-stats`
- [ ] Add `/admin stats` subcommand with `stop-sequences` option

#### 🏗️ Metrics & Monitoring (Prometheus)

Production observability with metrics collection.

- [ ] Add Prometheus metrics endpoint
- [ ] Key metrics: request latency, token usage, error rates, queue depth

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns to database for admin updates without deployment.

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [ ] **depcruise**: 25 known violations are all generated Prisma code (expected, keep suppressed). Switch from warning to blocking in pre-push hook — it's already clean for our code
- [ ] **CPD**: Currently non-blocking in pre-push. Once under target (<100 clones), add threshold check that blocks push
- [ ] **ESLint warnings**: `max-statements`, `complexity`, `max-lines-per-function` are warn-level. Audit current violation count, set a baseline, block new violations
- [ ] **Knip**: Dead code detection runs manually. Add to pre-push or CI as blocking check

Goal: every quality check that currently warns should eventually block, with a clear baseline so new violations are caught immediately.

#### 🧹 Ops CLI Command Migration

Migrate stub commands to proper TypeScript implementations.

---

### Theme: Moderation & Access Control

#### ✨ User Denylist

Block specific Discord users from using the bot entirely.

- [ ] Add `denylisted_users` table (discord_id, reason, denylisted_at, denylisted_by)
- [ ] Early-exit middleware in message handler

#### ✨ Server Denylist

Block the bot from operating in specific Discord servers.

- [ ] Add `denylisted_servers` table
- [ ] Auto-leave option when denylisted

---

## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Custom fetch wrapper, XML tag injection, multiple extraction paths. Needs stable foundation.

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ Consistent Service Prefix Injection

Auto-inject `[ServiceName]` prefix in logs instead of hardcoding.

#### 🧹 Logging Verbosity Audit

Some operations log at INFO when they should be DEBUG.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

### Code Quality (Quarterly Review)

#### 🧹 CPD Clone Reduction (149 clones, ~1.93%)

Well under 5% CI threshold. High-value extractions done (PR #599). Remaining clones are mostly structural similarity (personality route CRUD, factory `deepMerge` helpers, dashboard session boilerplate). Categories to investigate:

- Factory files: 5+ clones of `DeepPartial`/`deepMerge` — extract shared helper to common-types
- Personality routes: duplicate Prisma select objects, permission checks — extract route helpers
- Dashboard handlers: session/ownership boilerplate — may already have shared utils
- `dateFormatting.ts`: 4 clones of similar date formatting logic — consolidate
  Target: reduce to <100 clones or <1.5%. Revisit quarterly.

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Nice-to-Have Features

- **Bot Presence Setting** - `/admin presence set <type> <message>`, persist across restarts
- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Consolidate import-personality Scripts

`scripts/data/import-personality/` workspace needs cleanup.

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

---

## ⏸️ Deferred

_Decided not to do yet._

| Item                              | Why                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs | No breaking changes yet                                                                     |
| Contract tests for HTTP API       | Single consumer, integration tests sufficient                                               |
| Redis pipelining                  | Fast enough at current traffic                                                              |
| BYOK `lastUsedAt` tracking        | Nice-to-have, not breaking                                                                  |
| Handler factory generator         | Add when creating many new routes                                                           |
| Scaling preparation (timers)      | Single-instance sufficient for now                                                          |
| Vision failure JIT repair         | Negative cache now skipped during retries (PR #617); TTL expiry handles cross-request dedup |
| GLM 4.5 Air empty reasoning       | Model skips thinking when maxTokens budget is tight — model behavior, not our bug           |

---

## References

- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full release history
- [docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md](docs/proposals/backlog/OPENMEMORY_MIGRATION_PLAN.md)
- [docs/proposals/active/V2_FEATURE_TRACKING.md](docs/proposals/active/V2_FEATURE_TRACKING.md)
- [docs/research/sillytavern-features.md](docs/research/sillytavern-features.md)
- [docs/research/voice-cloning-2026.md](docs/research/voice-cloning-2026.md)
