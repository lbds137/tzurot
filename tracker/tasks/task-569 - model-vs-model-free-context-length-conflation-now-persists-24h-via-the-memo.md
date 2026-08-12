---
id: TASK-569
title: 'model vs model:free context-length conflation now persists 24h via the memo'
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 569000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: normalizeModelId strips :free and the catalog find accepts EITHER id without preferring the exact match (ModelCapabilityChecker.ts), so when a :free variant advertises a different context window than the paid base, the resolved length is catalog-array-order-dependent - and #2068’s memo extends that arbitrary winner to 24h across outages. Conflation is pre-existing; the memo lengthens its persistence.

Fix shape: prefer the exact-id match in the find; verify whether any configured :free model actually diverges (if none, document and downgrade).

Source: 2026-08-12 review, ai-worker LOW-4 PLAUSIBLE (needs a catalog check for a real divergent pair).
<!-- SECTION:DESCRIPTION:END -->
