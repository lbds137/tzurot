---
id: TASK-245
title: scoreExtraction double-embeds the extracted statements
status: Done
assignee: []
created_date: '2026-07-09 00:00'
updated_date: '2026-08-04 23:04'
labels:
  - 'area:ai-worker'
  - 'area:embeddings'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 245000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`scoreExtraction` double-embeds the extracted statements — `services/ai-worker/src/services/eval/factEquivalence.ts` — `scoreExtraction` calls `matchFacts(extracted, expectFacts)` then `matchFacts(extracted, [...expectFacts, ...allowedExtras])`, embedding the same `extracted` statements twice. Eval-only, manual, 50 goldens → not a concern now (reviewer agreed). **Fix shape**: memoize `embeddings.getEmbedding` per unique statement (roughly halves real-model latency/cost). **Promote when**: the extraction golden corpus grows toward the 100-sample re-open trigger. Surfaced 2026-07-09 (PR #1566 review).

**Why:** Eval cost/latency at larger corpus size.
<!-- SECTION:DESCRIPTION:END -->
