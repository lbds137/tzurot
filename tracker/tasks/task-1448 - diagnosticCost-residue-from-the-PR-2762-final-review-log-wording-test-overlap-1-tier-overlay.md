---
id: TASK-1448
title: >-
  diagnosticCost residue from the PR 2762 final reviews (log wording, test
  overlap, -1 tier overlay)
status: To Do
assignee: []
created_date: '2026-11-17T23:52:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1448000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR 2762 final round, filed at the review-round step-back. File: services/api-gateway/src/services/diagnosticCost.ts and its test.

1. A negative threshold (-1, "-1") parses fine but logs "Ignored pricing override with an unparseable threshold". Reword to unusable or add a reason field (negative | unparseable); the log text is pinned by tests, update them together.
2. Two tests overlap: "applies a numeric-string min_prompt_tokens threshold only above it" and "applies a string min_prompt_tokens threshold strictly: equal to it keeps the base price" both cover a string 100000 threshold; merge or co-locate.
3. In resolveTierPricing the overlay copies a price-shaped "-1" from a matched tier over a valid base price, so the estimate becomes null. Decide intent: if null is the honest answer for a variable-price tier, a one-line comment at the overlay; if not, gate the overlay on parseUsablePrice(value) !== undefined, with a test either way.

From the review of the squashed head (35c682f2c), also no blockers:

4. The condition filter does not separate price keys: a non-number value on a PRICE key inside an override (prompt: NaN, "abc", "0x1", whitespace) voids the entry, so the turn falls back to the base price, while a malformed BASE price gives a null estimate. Decide which an unusable tier price should give (null is the more honest under-pricing guard above the threshold); change the code or record the asymmetry in the file Residuals block, and pin it with a prompt: Number.NaN override test.
5. Rewrite the filter predicate double negative !(value === null || parseFiniteNumber(value) !== undefined) as value !== null && parseFiniteNumber(value) === undefined.
6. Optionally bound the logged raw threshold (a long string or nested object from the catalog bloats the debug line): slice strings to ~32 chars, log typeof otherwise.
7. Threshold-parser tests for "1e5", " 100000 " and "  " (the last logs as unparseable), pinning that the threshold path shares the price parser.

Acceptance: each item fixed or ruled out with its reason.
<!-- SECTION:DESCRIPTION:END -->
