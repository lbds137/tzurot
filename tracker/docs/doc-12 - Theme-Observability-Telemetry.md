---
id: doc-12
title: 'Theme: Observability & Telemetry'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Observability & Telemetry

_Focus: structured-log quality, log-query improvements, and analytics — explicitly NOT metrics infrastructure. Codebase-wide decisions on retry counts, timeouts, cache TTLs, and feature adoption currently rely on guesswork. Vision-pipeline telemetry (2026-04-14) was the prototype; the rest extends that pattern. **Approach: this theme stays on Pino + structured logs + Railway query DSL. Time-series metrics + distributed tracing (which may stand up OTel) are the complementary `doc-16` theme — load-correlated perf questions go there, log-shape questions come here.**_

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
  - **2026-08-12 intake (external Fable brief) weighs in for the custom table at current scale** (~12 weekly users): one append-only `command_events` table + saved SQL queries answers discoverability/error-rate/latency questions indefinitely at this N; no dashboard product, no PostHog ops burden. Re-open build-vs-buy only if user count grows ~5x.

#### 📥 2026-08-12 intake — observability brief (external Fable instance, owner-supplied)

Concrete P0/P1 shape for the two strategy sections above, plus new items. Design constraint carried from the brief, elevated to theme-level: **telemetry records _that_ things happened, never _what was said_** — no message/memory/prompt/audio content ever; command names, IDs, timestamps, durations, outcome codes, coarse counts only; any new data collection lands in the privacy policy **in the same release** (fail closed: no policy update written → the telemetry doesn't ship); telemetry rows are the user's data — included in `/export` scope, deleted by account erasure.

- **P0.1 `command_events` table** (small): append-only, one row per slash-command invocation — `occurred_at, user_id, guild_id (NULL for DM), channel_kind (coarse), command ('character.create'), character_id, outcome (ok|user_error|system_error|rate_limited|cancelled), error_code (stable code, not message), latency_ms, context JSONB`. The `context` JSONB takes only **allowlisted keys** (`model_family`, `provider`, `voice_mode`, …) — the writer strips/rejects unknown keys, unit-tested, so future features can't smuggle content into telemetry (drift guard in code, not convention). Every command path emits exactly one event, success and failure.
- **P0.2 error-channel reporter** (small): route unhandled exceptions + `system_error` outcomes to a private Discord channel via the bot itself — error code, command, stack hash, latency; deduped/rate-limited per stack hash so an error loop can't flood or self-DoS; reporter failure is provably non-fatal (fail open, log locally). GlitchTip/self-hosted Sentry only as a later upgrade path if channel grouping proves insufficient.
- **P1.1 discoverability report — ✅ SHIPPED 2026-08-25 (#2222, `pnpm ops telemetry:report`; zero-invocation roster join = TASK-773; the "ask users about dark features" follow-on remains open)** (small, offline from P0.1): saved SQL over trailing 30d — invocations + distinct users per command, "dark features" (0–1 distinct users), per-user command breadth, per-command error rate (elevated `user_error` = UX smell). Output is on-demand markdown, no dashboard. Follow-on: classify each dark feature *undiscovered* vs *unwanted* by asking the users directly (N≈12); the report just says what to ask about. Feeds `doc-25` Phase 2's help revamp.
- **P1.2 inference cost/latency attribution — ✅ SHIPPED 2026-08-26 (#2223; owner-approved shape: extended `usage_logs` instead of a sibling table — it already carried provider/model/token counts; delta = `latency_ms`/`byok`/`personality_id` + `pnpm ops telemetry:inference`; privacy rider shipped in the same PR)** (small–medium): sibling `inference_events` (or allowlisted context keys) — provider, model id, token **counts**, latency, byok-vs-free, character_id. Answers "what does the free tier cost me per week" / "which model is the latency outlier" in one query.
- **P1.3 export-path smoke test — ✅ SHIPPED 2026-08-26 (#2224; bot-client weekly scheduler + internal gateway route + `schemas/export/` contract schemas; snapshot-bound follow-up = TASK-774)** (small–medium): the export has ~zero organic exercise — silent-rot risk on a public tzurot.org trust promise. Scheduled/CI job runs a full export on a fixture account: ZIP opens, JSON parses against checked-in schemas (schemas double as export-contract docs), markdown non-empty + ID-consistent with JSON, row counts match source. Alerts to the P0.2 channel; a deliberately-broken fixture must fail it.
- **P2 (build only on demand)**: memory-pipeline health counters (truncation frequency ≈ context-pressure proxy), voice STT/TTS latency/failure per provider — counters/durations only. Prometheus/Grafana explicitly **deferred** (see `doc-16`). Progressive `/help` + contextual hints are product work → `doc-25` Phase 2, sequenced after P1.1 says which features are dark.
- **Suggested sequencing**: P0.1 → P0.2 → P1.3 → P1.1 (→ user conversations → doc-25 hints) → P1.2; privacy-policy update PR rides whichever ships first.
- **Owner decisions LOCKED (2026-08-23, P0 build kickoff)** — the P1 items inherit these: `command_events` retention = **raw 12 months, no rollups** (daily cleanup cron deletes past the cutoff; rollups deferred until a query needs longer history); export = **raw rows** in `/export`; `guild_id` = **stored raw**, named explicitly in the privacy-policy rider that ships with P0.1; ops alerts = **existing private server** via the `FEEDBACK_CHANNEL_ID` owner-channel path.
- **Open questions for the owner** (decision points when this theme goes active): `command_events` retention (pick deliberately, e.g. raw 12mo → monthly rollups); export telemetry as raw rows vs summarized (brief recommends raw); is `guild_id` retention OK under current privacy-policy language, or hash/coarsen; where ops alerts live (existing private server vs dedicated).
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

**Signals**: `finishReason` unknown/error (+0.4), `completionTokens` ≤1/≤5 (+0.3/+0.15), short response that did NOT hit the token limit (`finishReason` ≠ length) (+0.2), extreme ms-per-token (+0.2), empty content (+0.3). Threshold: ≥0.5. Max 1 content retry.

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
