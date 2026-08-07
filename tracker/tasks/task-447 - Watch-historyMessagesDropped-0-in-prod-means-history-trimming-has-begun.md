---
id: TASK-447
title: 'Watch: historyMessagesDropped > 0 in prod means history trimming has begun'
status: To Do
assignee: []
created_date: '2026-08-06 23:45'
updated_date: '2026-08-07 16:23'
labels:
  - 'area:ai-worker'
  - 'area:observability'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 447000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Trimming of conversation history is DORMANT in prod, measured 2026-08-06: across 89 consecutive requests in 24h, historyMessagesDropped was 0 on every one, and all 89 classified into the hard-cap budget branch with at least 21,100 tokens of headroom.

It is dormant, NOT impossible. At the tightest observed config (contextWindow 64,000, base 6,361) trimming begins at ~48,363 tokens of history, which is ~484 tokens per message across a 100-message window. 100 is reachable: the fetch limit is min(maxMessages ?? 50, 100) and 50 is only the default. The realistic path is attachment-heavy conversation, since Discord allows up to 10 attachments per message and each contributes a vision description to the rendered entry.

Why THIS signal: historyMessagesDropped is already recorded per request in the llmDiagnosticLog tokenBudget payload. It needs no new instrumentation, and unlike any per-entry size model it cannot be wrong. Every attempt to estimate rendered entry size during the 2026-08-06 analysis was wrong, because no stored field equals the rendered form (same root cause as TASK-370, where cached tokenCount understated rendered size by 60-87 percent).

Action when it fires: the cache-aware history-window policy in docs/proposals/backlog/prompt-assembly-architecture.md section 2.5 stops being theoretical. Build the chunked eviction as specified, and reconsider window-start quantization with real data to tune against.

Query: count rows in llm_diagnostic_logs over the last 24h where data->tokenBudget->>historyMessagesDropped is greater than 0. 24h retention, so this wants a periodic check rather than a one-off.

Acceptance: a scheduled or ops-health check reports the count, and a non-zero result surfaces to the owner.
<!-- SECTION:DESCRIPTION:END -->
