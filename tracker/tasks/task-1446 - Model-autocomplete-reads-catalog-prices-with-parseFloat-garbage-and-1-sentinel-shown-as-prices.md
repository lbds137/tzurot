---
id: TASK-1446
title: >-
  Model autocomplete reads catalog prices with parseFloat (garbage and -1
  sentinel shown as prices)
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
Why: services/api-gateway/src/services/OpenRouterModelCache.ts:397-398 (toAutocompleteOption) reads model.pricing.prompt and .completion with parseFloat and turns NaN into 0. PR 2762 made parseFiniteNumber / parseUsablePrice in diagnosticCost.ts the single catalog-number parser, but this second read was outside its diff (claude-review on PR 2762, final round). Same catalog value, two readings: "0.1abc" shows as $100,000/M in autocomplete while the diagnostic estimate is null; a "-1" variable-price sentinel would show as -$1,000,000/M (code-reading; whether the live catalog sends -1 for any listed model is unverified, probe the cache first).

What: export parseUsablePrice (or move it to a small shared api-gateway module) and use it in toAutocompleteOption; decide what an unusable price displays (0 vs unknown, a user-visible choice: ask Lila if it changes the rendered text).

Acceptance: autocomplete and the diagnostic estimate agree on every catalog string; tests pin "0.1abc", "-1" and a decimal price through toAutocompleteOption.

In beta.246 per Lila 11-17 ("sure, we can include that in the release").
<!-- SECTION:DESCRIPTION:END -->
