---
id: TASK-1450
title: usage_logs records no cache tokens, so cache hit rate has no durable history
status: To Do
assignee: []
created_date: '2026-11-18T04:05:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1450000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 11-18 asked whether z.ai caching had broken. Answering it took a hand sweep of three Railway deployments' "Generated response" log lines (GLM hit rate 22% 10-27..11-03, 13% 11-03..11-12, 14% beta.245). The only durable usage record, usage_logs (prisma/schema.prisma model UsageLog), stores tokensIn/tokensOut/model/provider/requestType/latencyMs/byok/personalityId and nothing about cache reads or writes. llm_diagnostic_logs carries cachedPromptTokens and cachedWriteTokens in its JSON payload, but it is deleted after 7 days (DIAGNOSTIC_LOG_RETENTION_HOURS = 168, common-types constants/diagnostics.ts). So cache effectiveness and the money it saves have no history beyond Railway log retention, and telemetry:inference (pnpm ops telemetry:inference) cannot report them. Owning theme: doc-12 P1.2 (usage_logs + telemetry:inference), beside TASK-1223.

What: add nullable cache_read_tokens and cache_write_tokens columns to usage_logs, with null meaning "provider did not report" (never zero). The chat llm_generation writer fills them from the same usage_metadata.input_token_details the 'Generated response' log line reads (cacheObservability.ts). Other writers fill them where the value is in scope. Extend telemetry:inference with a hit-rate section per provider and model (read share of prompt tokens, share of calls with any hit). Consider a cost-estimate column only if TASK-1428's cache-aware estimator can be reused at write time without catalog lookups on the hot path; otherwise compute cost in the report.

Riders in the same PR (same file): two schema.prisma comments still say the diagnostic log lasts 24 hours (the thinking_content comment "24h diagnostic log" and model LlmDiagnosticLog "auto-deleted after 24 hours"); the job keeps 7 days. Fix both.

Acceptance: a migration (additive) plus a writer test asserting what crosses into the usage row; telemetry:inference prints the per-model hit rate for a date range; one prod week of rows reproduces the log-derived rate within a few points.

Shipped: PR 2770 (merged 11-19, dev migrated same day). First three acceptance clauses met; the fourth (one prod week vs the log-derived rate) is the reason this task stays OPEN. Acceptance-plan notes for that comparison:
- Accounting: usage rows record only the FINAL attempt of a multi-attempt generation (pre-existing writer behavior the cache columns inherit); the log baseline counts every Generated-response line, retries included — a few-point drift from the retry fraction is not a writer bug.
- Reported vs Requests: PR 2771 scoped the cache section to `llm_generation` (non-chat writers no longer inflate `Requests`), so a large Reported-vs-Requests gap now means omitted zeros OR pre-migration chat rows (in-window chat rows written before the columns existed, counted toward `Requests` with NULL cache data until they age out). Read the gap accordingly during the comparison window.
- readShare assumes tokens_in includes cached reads (true for OpenAI-compatible prompt_tokens; unverified per-provider) — any row showing cache_read_tokens > tokens_in is this, not a writer bug.
- Baseline: 31% of calls with any hit, ~17% read share, n=26, all z.ai implicit caching (11-19 log sweep).
- Live evidence 11-19: PRE-migrate dev probe — the cache-query failure surfaces as a P2010 wrap carrying raw SQLSTATE 42703 + the column name; the unavailable caption rendered and other sections printed (a typed-P2022 mapping was hypothesized in review and falsified). POST-migrate dev dry run — the Q-cache FILTER-clause SQL ran clean on the migrated schema; all-null caption + em dashes rendered; Reported 0 until post-migrate chat rows accumulate.
<!-- SECTION:DESCRIPTION:END -->
