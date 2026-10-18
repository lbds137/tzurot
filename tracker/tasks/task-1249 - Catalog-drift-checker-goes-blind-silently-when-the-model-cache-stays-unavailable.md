---
id: TASK-1249
title: >-
  Catalog drift checker goes blind silently when the model cache stays
  unavailable
status: To Do
assignee: []
created_date: '2026-10-18 23:40'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 1237000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since PR 2632 (TASK-1240) an unavailable lookup is skipped (correct per cycle) and logged as one warn per cycle with only a count (services/api-gateway/src/services/CatalogDriftChecker.ts check()). If lookupModelById keeps returning unavailable, drift detection is off and a week of blindness looks like a week of no drift. Raised by claude-review on PR 2632 round 4.

What: include the first few modelIds in the warn, and escalate (error-level log or an owner alert through the same queue) after N consecutive cycles in which every watched pair came back unavailable. Pick N from the refresh cadence (CATALOG_REFRESH_INTERVAL_MS in ModelCatalogRefresher.ts).

Acceptance: N all-unavailable cycles produce one escalation; a recovered cycle resets the counter; tests pin both.
<!-- SECTION:DESCRIPTION:END -->
