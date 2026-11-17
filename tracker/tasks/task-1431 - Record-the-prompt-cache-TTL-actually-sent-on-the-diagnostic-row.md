---
id: TASK-1431
title: Record the prompt-cache TTL actually sent on the diagnostic row
status: To Do
assignee: []
created_date: '2026-11-17T00:15:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1431000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2758 round-1 review. The inspect cost estimate (services/api-gateway/src/services/diagnosticCost.ts, cacheWriteTtlFor) infers the cache-write TTL from the model id and the current PROMPT_CACHE_TTL constant, because the diagnostic row does not record the TTL ai-worker sent (services/ai-worker/src/services/ModelFactory.ts builds extraParams.cacheControl). So a historic row is priced at today's constant, and an anthropic/ row with promptCaching off but provider-reported writes is priced at the 1h rate.

What: record the sent cacheControl ttl (or none) on the diagnostic llmResponse/llmConfig in DiagnosticRecorders, and have diagnosticCost prefer the recorded value, falling back to the inference for older rows.

Acceptance: a row recorded with ttl 5m prices writes at input_cache_write; a row with no TTL sent and writes > 0 uses the default rate; tests at the recorder and the estimate.

Also (PR 2758 round-4 suggestion): cross-check the modelled saving (`noCacheTotalUsd - totalUsd`) against the row's billed `cacheDiscount` (`packages/common-types/src/types/diagnostic.ts`, `cacheDiscount?: number`) as a debug log or breakdown-view field. That tests the two premises the diagnosticCost.ts header lists (promptTokens includes reads and writes; the 5m/1h write-TTL reading) against real billing.
<!-- SECTION:DESCRIPTION:END -->
