---
id: TASK-1381
title: Log when DependencyStep's provenance join misses a context attachment
status: To Do
assignee: []
created_date: '2026-11-10T05:23:00Z'
updated_date: '2026-11-10T05:23:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1364000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1380 (PR 2736) restores trigger-attachment metadata by joining job results to context attachments on originalUrl ?? url (restoreOriginalMetadata in services/ai-worker/src/jobs/handlers/pipeline/steps/DependencyStep.ts). If a future producer changes URL shape on one side only (e.g. strips the signed ?ex/is/hm query), every entry silently falls back to placeholder metadata and the spoiler/sticker/voice/link-preview headers vanish again with no signal - the same silent regression TASK-1380 fixed. Surfaced by claude-review round 3 on PR 2736.

What: in restoreOriginalMetadata, when originals is non-empty and an entry finds no match, log once per call with counts only ({ jobId or requestId, unmatched, contextCount }, no URLs or filenames per the PII rules). Also note in its JSDoc that the joined metadata.size is the post-download (post-resize) byte count from DownloadAttachmentsStep (DownloadAttachmentsStep.ts:189-197, 269), not Discord's reported size.

Acceptance: a test with one unmatched entry asserts the log call and its count-only fields; the JSDoc names the size provenance. Depends on PR 2736 merging (state flips to ready then).
<!-- SECTION:DESCRIPTION:END -->
