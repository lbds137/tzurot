---
id: TASK-73
title: Typed aggregated error for DownloadAttachmentsStep.downloadAll
status: To Do
assignee: []
created_date: '2026-04-24 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Typed aggregated error for `DownloadAttachmentsStep.downloadAll`

**Why:** Per-attachment failures inside `downloadAll` are typed (`HttpError`, `AttachmentTooLargeError`), but the step-level aggregation collapses into anonymous `new Error('Failed to download N attachment(s): ...')`. Callers (`LLMGenerationHandler.processJob`'s catch) can't `instanceof`-classify without string-parsing. **Acceptable today**: failure surfaces to user as async error regardless of classification; no retry/backoff policy keys off the aggregated type. **Fix shape when needed**: introduce `AggregateAttachmentDownloadError extends Error` carrying `failures: Array<{ name: string; error: Error }>`, keep message format for log compat. **Promote when**: we want differentiated retry policy ("retry whole job if all failures are transient" vs "fast-fail if any 403") or differentiated user-facing messages by failure class. Surfaced 2026-04-24 by PR #889 Round 6 claude-review. Deferred 2026-04-24.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): NARROWED. The aggregated throw shrank under ae7a99bef to the all-failed-and-no-text path, and LLMGenerationHandler classifies by step name, not instanceof, so nothing is blocked today. Weak keep: remaining scope is the typed-error question with no current caller needing it.
---
<!-- COMMENTS:END -->
