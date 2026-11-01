---
id: TASK-1330
title: Failed re-summarize stops a good stored memory summary rendering
status: To Do
assignee: []
created_date: '2026-11-01T11:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1313000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: writeArchiveSummaryFailure (services/ai-worker/src/services/archiveSummary/archiveSummaryStore.ts) sets summary_status to failed or dead without regard to an existing summary, and hasSummary (services/ai-worker/src/utils/memoryUtils.ts) honours only done. So a billed failure while refreshing a done row at a stale prompt version stops its good summary rendering. This contradicts MEM-ARCH-021 and the intent recorded in TASK-906 (done rows keep rendering the old summary). Introduced by the prompt-version bump flow, exposed by PR 2626.

Measured in prod 2026-11-01 (read-only, docs/local/glm-audit/stranded-summaries.mjs): 39 rows with a stored summary not rendering, all recalled, 2 personalities, 2 personas; 38 failed, 1 dead; error classes overflow 35, parse_failure 4. 2146 done rows remain at v1 and are exposed on recall. Text is retained in the row; the note falls back to the excerpt or facts.

Fix shape: make the invariant "a non-empty assistant_summary describes the current content". The renderer and the sibling reader (packages/conversation-history/src/assistantSummaryLookup.ts) render any stored summary; status only drives retries. The failure write clears the summary only when the content hash differs. No prod data write needed: the 39 heal on deploy, unless a content edit made one stale, which must be checked first.

Acceptance: a failed or dead refresh with unchanged content keeps rendering; a content edit never renders a stale summary; retry and dead accounting per MEM-ARCH-020 unchanged; specs updated; regression test fails before the fix.
<!-- SECTION:DESCRIPTION:END -->
