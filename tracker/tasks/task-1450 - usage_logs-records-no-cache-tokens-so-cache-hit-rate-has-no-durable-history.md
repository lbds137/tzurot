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
Why: Lila 11-18 asked whether z.ai caching had broken. Answering it took a hand sweep of three Railway deployments' "Generated response" log lines (GLM hit rate 22% 10-27..11-03, 13% 11-03..11-12, 14% beta.245). The only durable usage record, usage_logs (prisma/schema.prisma model UsageLog), stores tokensIn/tokensOut/model/provider/requestType/latencyMs/byok/personalityId and nothing about cache reads or writes. llm_diagnostic_logs carries cachedPromptTokens and cachedWriteTokens in its JSON payload, but it is deleted after 24 hours. So cache effectiveness and the money it saves have no history beyond Railway log retention, and telemetry:inference (pnpm ops telemetry:inference) cannot report them. Owning theme: doc-12 P1.2 (usage_logs + telemetry:inference), beside TASK-1223.

What: add nullable cache_read_tokens and cache_write_tokens columns to usage_logs, with null meaning "provider did not report" (never zero). The chat llm_generation writer fills them from the same usage_metadata.input_token_details the 'Generated response' log line reads (cacheObservability.ts). Other writers fill them where the value is in scope. Extend telemetry:inference with a hit-rate section per provider and model (read share of prompt tokens, share of calls with any hit). Consider a cost-estimate column only if TASK-1428's cache-aware estimator can be reused at write time without catalog lookups on the hot path; otherwise compute cost in the report.

Acceptance: a migration (additive) plus a writer test asserting what crosses into the usage row; telemetry:inference prints the per-model hit rate for a date range; one prod week of rows reproduces the log-derived rate within a few points.
<!-- SECTION:DESCRIPTION:END -->
