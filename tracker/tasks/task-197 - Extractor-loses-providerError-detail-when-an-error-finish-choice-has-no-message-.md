---
id: TASK-197
title: >-
  Extractor loses providerError detail when an error-finish choice has no
  message stub
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extractor loses providerError detail when an error-finish choice has no `message` stub

**Why:** `validateAndExtractRawMessage` (extractOpenRouterReasoning.ts) returns null when `choices[0].message` is absent, so `buildOpenrouterMetadata` never runs and `response_metadata.openrouter.providerError` is not captured for that shape. The invoker's error-finish throw/retry is unaffected (it reads `finish_reason` from native metadata) — only the diagnostic detail in the warn log + /inspect is lost. The confirmed prod incident carried a message stub, so this is a hypothetical variant. **Fix shape**: capture the error object before the message-stub gate (or relax the gate to proceed with metadata-only extraction when an error object exists). **Promote when**: a prod error-finish warn log appears WITHOUT providerErrorDetail, or next touching the extractor. Surfaced 2026-07-02 (PR #1462 review).
<!-- SECTION:DESCRIPTION:END -->
