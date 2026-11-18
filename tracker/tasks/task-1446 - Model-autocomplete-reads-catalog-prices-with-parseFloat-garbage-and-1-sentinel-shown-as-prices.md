---
id: TASK-1446
title: >-
  Model autocomplete reads catalog prices with parseFloat (garbage shown as a
  price, unreadable shown as free)
status: To Do
assignee: []
created_date: '2026-11-17T23:52:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1446000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/api-gateway/src/services/OpenRouterModelCache.ts:397-398 (toAutocompleteOption) reads model.pricing.prompt and .completion with parseFloat and turns NaN into 0. PR 2762 made parseFiniteNumber / parseUsablePrice in diagnosticCost.ts the single catalog-number parser, but this second read was outside its diff (claude-review on PR 2762, final round). Same catalog value, two readings: "0.1abc" shows as $100,000/M in autocomplete while the diagnostic estimate is null. Worse, a non-numeric price ("abc") becomes NaN, then 0, and bot-client treats 0/0 as FREE (services/bot-client/src/utils/modelAutocomplete.ts:128 isModelFree, FREE badge at :150), so a model with an unreadable price is badged free.

CORRECTION (11-17, code read at filing was wrong): a "-1" price does NOT render as a negative price. Negative is the designed "no concrete price" sentinel: services/bot-client/src/utils/modelCatalog.ts:112 sets hasPricing false for any negative price (routers like openrouter/auto), and services/bot-client/src/commands/models/card.ts:77-78 renders that as "Variable" (or "z.ai plan"). So parseUsablePrice is the WRONG parser here: it rejects -1 and would break the router display.

What: in toAutocompleteOption, parse each price with the strict parser (parseFiniteNumber semantics: decimal or exponent form, finite). Keep a parsed negative as is (the sentinel). Map anything unparseable to the same negative sentinel (-1 per million is enough), never to 0. Display: RECOMMENDED (awaiting Lila's yes, asked 11-17): an unusable price shows as "Variable" with no free badge, reusing the existing sentinel path; no new UI text. Share the parser rather than copy it (export from diagnosticCost.ts or a small shared api-gateway module); see TASK-1447 for the cross-service consolidation.

Acceptance: tests through toAutocompleteOption pin a decimal price, "-1" (stays negative), "0.1abc" and "abc" (both become the negative sentinel, so hasPricing is false and no FREE badge), and "0" (still free). No ModelAutocompleteOption schema change.

In beta.246 per Lila 11-17 ("sure, we can include that in the release").
<!-- SECTION:DESCRIPTION:END -->
