---
id: TASK-1396
title: >-
  Provenance join miss puts the signed CDN query string into the prompt and the
  stored row
status: Done
assignee: []
created_date: '2026-11-10T14:30:00Z'
updated_date: '2026-11-11T04:40:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1379000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: when an image child job succeeds but the generation job download of the same attachment fails, DownloadAttachmentsStep.ts:222 writes back successes only, so DependencyStep restoreOriginalMetadata misses and the rebuilt entry keeps name = img.url.split(/).pop() (DependencyStep.ts:503), which includes ?ex=..&is=..&hm=.. . RAGUtils renders [Image: cat.png?ex=...] into the prompt and visionDescriptionWriter persists it; the deduped orphan loop puts the same basename in <image filename=>. A voice message on the same miss renders [Audio: name], which OUTPUT_CONSTRAINTS reads as possibly someone else (TASK-1383 residue; PR 2738 only logs it).
Distinct from TASK-1385 (log fields): this is model-facing and persisted. Found by the Fable attachment-provenance review 2026-11-10 (D2).
Narrow fix: derive the fallback name from new URL(url).pathname basename; keep the join on the pre-download attachment list rather than the successes-only list. Structural fix: attachment-spined preprocessing (provenance redesign doc).
Acceptance: a test with a failed download renders no query string and keeps the voice label.
<!-- SECTION:DESCRIPTION:END -->
