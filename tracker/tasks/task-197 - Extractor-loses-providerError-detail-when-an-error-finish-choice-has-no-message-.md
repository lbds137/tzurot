---
id: TASK-197
title: >-
  Extractor loses providerError detail when an error-finish choice has no
  message stub
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extractor loses providerError detail when an error-finish choice has no `message` stub

**Why:** `validateAndExtractRawMessage` (extractOpenRouterReasoning.ts) returns null when `choices[0].message` is absent, so `buildOpenrouterMetadata` never runs and `response_metadata.openrouter.providerError` is not captured for that shape. The invoker's error-finish throw/retry is unaffected (it reads `finish_reason` from native metadata) — only the diagnostic detail in the warn log + /inspect is lost. The confirmed prod incident carried a message stub, so this is a hypothetical variant. **Fix shape**: capture the error object before the message-stub gate (or relax the gate to proceed with metadata-only extraction when an error object exists). **Promote when**: a prod error-finish warn log appears WITHOUT providerErrorDetail, or next touching the extractor. Surfaced 2026-07-02 (PR #1462 review).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `validateAndExtractRawMessage` in `extractOpenRouterReasoning.ts` still returns `null` (and deletes `__raw_response`) when `choices[0].message` is undefined, before `buildOpenrouterMetadata` (which captures `providerError`) ever runs. Premise unchanged. Evidence: `sed -n '145,161p' services/ai-worker/src/services/modelFactory/extractOpenRouterReasoning.ts` → `if (rawMessage === undefined) { delete kwargs.__raw_response; return null; }`.
---
<!-- COMMENTS:END -->
