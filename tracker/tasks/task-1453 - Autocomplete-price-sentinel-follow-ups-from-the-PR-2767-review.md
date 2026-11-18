---
id: TASK-1453
title: Autocomplete price-sentinel follow-ups from the PR 2767 review
status: To Do
assignee: []
created_date: '2026-11-18T08:05:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1453000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR 2767 (TASK-1446, head 502d79d54, no blockers), filed rather than looped so beta.246 can cut. Related: TASK-1447 (cross-service parser consolidation) — the contract item below can land with it.

1. The "negative price = no concrete price" contract between api-gateway and bot-client is recorded only in a comment (OpenRouterModelCache.ts, NO_CONCRETE_PRICE_PER_MILLION). bot-client's readers are modelCatalog.ts:112 (hasPricing = price >= 0) and modelAutocomplete.ts:128 (isModelFree, === 0). A change to either silently breaks the TASK-1446 fix. Share a named constant or predicate (e.g. hasConcretePrice) from common-types and use it on both sides, or at minimum make the comment name those predicates.
2. An unparseable catalog price now silently shows as "Variable"; log { modelId } once per catalog refresh (where the fetch is processed, not in toAutocompleteOption, which runs per filter call).
3. Nit: catalogNumber.ts is a pure helper; move it and its test to services/api-gateway/src/utils/ to match the layout.
4. Nit: add a whitespace-only case ('   ') to catalogNumber.test.ts (the JSDoc lists it as rejected; only diagnosticCost.test.ts covers it indirectly).
5. Nit: the "-1" case in OpenRouterModelCache.test.ts asserts toBe(-1_000_000) and also toBeLessThan(0); drop the redundant assertions.

Acceptance: each item done or ruled out with its reason.
<!-- SECTION:DESCRIPTION:END -->
