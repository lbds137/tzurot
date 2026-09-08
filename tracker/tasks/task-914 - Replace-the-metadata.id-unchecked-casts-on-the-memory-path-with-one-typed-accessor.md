---
id: TASK-914
title: >-
  Replace the metadata.id unchecked casts on the memory path with one typed
  accessor
status: To Do
assignee: []
created_date: '2026-09-08 03:43'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 912000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: five sites read a memory document id as `doc.metadata?.id as string | null | undefined` while `PgvectorMemoryDocument.metadata` is `Record<string, unknown>`, so nothing static guarantees the id is a string. Every current producer (`mapQueryResultToDocument` in services/ai-worker/src/utils/memoryUtils.ts, from the uuid `m.id` column) emits a string, so no runtime defect is known; the cast is a robustness gap, flagged by claude-review on PR 2366 as repeated-not-introduced. Sites: `grep -rn "metadata?\.id as" services/ai-worker/src --include=*.ts` minus tests -> PgvectorChannelScoping.ts (excludeIds and dedupeById), PgvectorMemoryAdapter.ts (collectRetrievalIds), memoryUtils.ts (extractChunkGroups, mergeSiblings).
Fix shape: one exported accessor in memoryUtils.ts, e.g. `memoryIdOf(doc): string | undefined`, that returns the id only when `typeof id === string` and non-empty (reuse `isValidId`), and each site calls it; the five casts go away. One unit test for the accessor covering string, empty string, null, undefined, and a non-string value.
Acceptance: the grep above returns zero non-test hits; ai-worker unit suite green; no behavior change for string ids (the existing waterfall and adapter tests stay green unchanged).
<!-- SECTION:DESCRIPTION:END -->
