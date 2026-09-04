---
id: TASK-569
title: 'model vs model:free context-length conflation now persists 24h via the memo'
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:37'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost (arbitrary, catalog-array-order-dependent context length, now persisted 24h). The catalog lookup still doesn't prefer an exact-id match. Evidence: `grep -n "models.find" services/ai-worker/src/services/ModelCapabilityChecker.ts` → `models.find(m => m.id === normalizedId || m.id === modelId)` (line 102), first match wins, no exact-match preference.
---
<!-- COMMENTS:END -->
