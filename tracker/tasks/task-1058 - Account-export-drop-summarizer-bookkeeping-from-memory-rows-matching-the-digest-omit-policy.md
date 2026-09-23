---
id: TASK-1058
title: >-
  Account export: drop summarizer bookkeeping from memory rows, matching the
  digest omit policy
status: Done
assignee: []
created_date: '2026-09-23 18:06'
updated_date: '2026-09-23 19:21'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1052000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the account export writes each Memory row whole (Prisma MemoryGetPayload, no omit), so memories/*.json ships the summarizer and retrieval bookkeeping: summaryStatus, summaryAttempts, summaryLastError, summaryModel, summaryPromptVersion, sourceContentHash, summaryRequestedAt, summaryCompletedAt, lastRetrievedAt, retrievalCount. The recent-days digest export (1247456f9, TASK-1014) deliberately omits status, attempts and last_error as operational state rather than user content, so the two are inconsistent, and summaryLastError can carry internal error text into a user export. Surfaced by the TASK-1056 schema sweep (PR #2489), which made ExportMemoryRowSchema accept these columns as the producer writes them today.
Owner ruling 2026-09-23: apply the same rule as the digests. Keep assistantSummary (it summarizes the user own conversation), drop the rest.
Fix shape: omit the listed columns in the memory query/mapping of services/ai-worker/src/jobs/AccountExportAssembler.ts; remove them from ExportMemoryRowSchema (packages/common-types/src/schemas/export/accountExportCoreSchemas.ts); regenerate the account-export golden fixtures (TESTING.md regenerate list) so the producer and consumer contract tests pin the new shape; update the privacy policy or export README only if either enumerates exported memory fields (check docs/legal/PRIVACY_POLICY.md and AccountExportFiles.ts README text).
Acceptance: an exported memory file carries assistantSummary and none of the listed columns; the contract test goes red if a dropped column reappears in the producer; the strict schema rejects a row carrying one.
Second member (claude-review on PR #2489): ExportPersonaDigestSchema.digestText is a bare z.string() although the producer skips null or empty digestText (AccountExportAssembler.ts fetchPersonaDigests: `if (row.digestText === null || row.digestText.length === 0) continue`). Make it z.string().min(1) so the schema states the only-rows-with-text-ship invariant, with a unit case rejecting an empty digestText. Same schema file as this task, so it rides along.
<!-- SECTION:DESCRIPTION:END -->
