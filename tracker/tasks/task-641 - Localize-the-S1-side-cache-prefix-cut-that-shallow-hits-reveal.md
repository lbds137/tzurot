---
id: TASK-641
title: Localize the S1-side cache-prefix cut that shallow hits reveal
status: To Do
assignee: []
created_date: '2026-08-17 12:08'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 641000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 0 measured prod zai-coding shallow hits (53 of 99) caching ~5.1k of ~32k prompt tokens. The pre-chat_log sections measure ~28,350 chars (~7.9k tokens at a rough 3.6 chars/token), so the cache cut lands INSIDE S1, before chat_log begins — meaning an S1-side divergence is truncating the prefix in addition to the chat_log head slide that beta.204 PR 2 fixes. This may bound the win: if S1 cuts at ~5.1k, stabilizing chat_log below that point buys nothing on those turns.

What is NOT established: which section. The figures are means across requests with different personas (system_identity alone averages 15,220 chars and differs per persona), and means of ratios cannot localize a boundary.

Fix shape: per-request analysis on single-persona channels using a real tokenizer rather than a chars/token estimate — walk the stored systemPromptSections offsets for one channel and compare consecutive requests hash-by-section (cacheObservability already computes promptHashSystemCore), then map the measured cached_tokens onto the section map to find where the match ends.

Acceptance: the section at which the prefix diverges on shallow-hit requests is named with evidence, and either fixed or recorded as inherent (e.g. multi-persona channels legitimately diverge at system_identity).

Measurements: the doc-17 PR 0 MEASUREMENTS section (2026-08-17).
<!-- SECTION:DESCRIPTION:END -->
