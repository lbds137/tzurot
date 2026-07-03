### Theme: Observability & Telemetry

_Focus: structured-log quality, log-query improvements, and analytics — explicitly NOT metrics infrastructure. Codebase-wide decisions on retry counts, timeouts, cache TTLs, and feature adoption currently rely on guesswork. Vision-pipeline telemetry (2026-04-14) was the prototype; the rest extends that pattern. **Approach: this theme stays on Pino + structured logs + Railway query DSL. Time-series metrics + distributed tracing (which may stand up OTel) are the complementary [`production-observability-perf-metrics-tracing.md`](production-observability-perf-metrics-tracing.md) theme — load-correlated perf questions go there, log-shape questions come here.**_

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
