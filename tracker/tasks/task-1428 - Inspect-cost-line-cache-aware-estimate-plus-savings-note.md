---
id: TASK-1428
title: 'Inspect cost line: cache-aware estimate plus savings note'
status: Done
assignee: []
created_date: '2026-11-16T20:44:00Z'
updated_date: '2026-11-17T02:22:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1428000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner ruling 2026-11-16 (AskUserQuestion, "Cache-aware + savings"): the inspect embed cost line prices cached prompt tokens at full rate (services/bot-client/src/commands/inspect/costLine.ts:13 caveat; computation in services/api-gateway/src/services/diagnosticCost.ts), so caching savings are invisible. OpenRouter /models pricing carries input_cache_read, input_cache_write and input_cache_write_1h per model (read 2026-11-16 for anthropic/claude-haiku-5.5: prompt 0.10, cache read 0.01, 1h write 0.20 USD per million).

What: carry the cache prices through the model catalog into EstimatedCost; compute uncached input (prompt - cachedPromptTokens - cachedWriteTokens) at prompt price, cached reads at cache-read price, writes at the write price matching the configured TTL (1h vs 5m), completion at completion price; render the total plus a short note of the saving versus the same tokens with no cache. Models without cache prices fall back to today line and caveat. Worked example (dev turn 2026-11-16 20:41Z, haiku-5.5): prompt 13,613, cached 9,334, write 77, completion 212 -> about 0.0006 USD with cache vs 0.0015 today, saved about 0.0008.

Acceptance: unit tests for the pricing arithmetic (cache prices present, absent, zero writes) and the rendered line; the Response field stays within Discord embed field limits.
<!-- SECTION:DESCRIPTION:END -->
