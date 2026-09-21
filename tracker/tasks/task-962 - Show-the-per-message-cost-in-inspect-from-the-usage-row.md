---
id: TASK-962
title: Show the per-message cost in /inspect from the usage row
status: Done
assignee: []
created_date: '2026-09-13 17:24'
updated_date: '2026-09-21 21:21'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 959000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shapes.inc surfaces the exact cost, credits used, and engine for every message. Tzurot already records tokens per generation in usage_logs and shows the model in the reply footer, but nowhere renders what one message cost. /inspect is the natural home (it already shows the model, routing, and token budget).
Fix shape: in the /inspect payload or its bot-client render, add a cost line derived from the usage row for that request (prompt/completion tokens × the model price where a price is known; tokens only where it is not — say which). No new storage. Check the OpenRouter model cache for a per-token price field before adding a price table.
Acceptance: /inspect on a reply shows tokens and, where the model has a known price, the cost; the render falls back to tokens-only without an error when no price exists.

PREMISE CORRECTION (grounding read 2026-09-21, before dispatch): the usage row is NOT reachable from an inspected message. usage_logs (prisma/schema.prisma, the UsageLog model) carries userId, provider, model, tokensIn, tokensOut, createdAt, byok, personalityId and no requestId, while the diagnostic log is keyed by requestId (LlmDiagnosticLog.requestId, unique); the shared columns are not a key. The cost source is the diagnostic payload itself: llmResponse already carries promptTokens, completionTokens, modelUsed, routedModel and provider (packages/common-types/src/types/diagnostic.ts, the llmResponse block around lines 270-320), which is exactly the input the usage row would have given. The price source is OpenRouterModelCache in api-gateway (services/api-gateway/src/services/OpenRouterModelCache.ts, toAutocompleteOption derives promptPricePerMillion and completionPricePerMillion from model.pricing) - reachable from the diagnostic read route (services/api-gateway/src/routes/admin/diagnostic.ts, handleGetDiagnosticByRequestId, path GET /api/user/diagnostic/:requestId) and NOT from bot-client or ai-worker.
Revised fix shape, still no new storage: enrich at READ. The diagnostic response schema (packages/common-types/src/schemas/api/diagnostic.ts) gains an optional estimatedCost object (promptUsd, completionUsd, totalUsd, promptPricePerMillion, completionPricePerMillion, priceSource) computed in the route from the payload tokens and the cache price for routedModel ?? modelUsed, null when the cache has no entry (non-OpenRouter providers, BYOK on another provider, router aliases that never resolved); bot-client renders a Cost line under the token lines when present and nothing extra when null. Label it an estimate at OpenRouter list price: cached prompt tokens (the cachedTokens field) are billed lower by some providers and are not modelled in the first cut - say so in the render or the field name. The bot-client render file (services/bot-client/src/commands/inspect/embed.ts) counts 402 ESLint lines against the 400 cap, so the cost formatter is extracted to its own module with a colocated test.
<!-- SECTION:DESCRIPTION:END -->
