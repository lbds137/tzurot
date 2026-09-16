---
id: TASK-991
title: Cross-persona memory notes render under the first-person archive framing
status: To Do
assignee: []
created_date: '2026-09-16 12:30'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 987000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: with shareLtmAcrossPersonalities on, MemoryRetriever drops the personalityId filter (services/ai-worker/src/services/MemoryRetriever.ts, the shareLtmAcrossPersonalities ternary), so the memory_archive block carries verbatim assistant-side prose from OTHER personas (Emily, Carmilla Carmine, Vaggie, Hyun-ae observed in two 2026-09-16 debug exports) under MEMORY_ARCHIVE_INSTRUCTION, which tells the model these are its own recalled memories (services/ai-worker/src/services/prompt/MemoryFormatter.ts). Lilith answered as if Emily held her; a retrieved note shows the same speaker-misattribution class recurred earlier with Sophia. The facts block is private-pool and unaffected; current-channel history is correctly speaker-attributed. Verified by reading both payloads and the two files above; the export nulls per-memory personalityId, so attribution rests on the name-prefixed lines inside the notes plus the code path, not on a JSON field.
Fix shape: extend stampArchiveRenderMode (services/ai-worker/src/services/factRetrievalHelper.ts) to force split-mode rendering for any doc whose metadata.personalityName differs from the current personality, independent of the archiveSplitRenderPersonalities allowlist; split mode already omits the stored assistant prose and uses the persona-aware third-person MEMORY_ARCHIVE_SPLIT_INSTRUCTION. Alternative: keep verbatim render but swap the framing to third person for foreign notes. Add the cross-persona case to docs/proposals/backlog/memory-archive-format.md section 0.
Acceptance: a unit test with a foreign-persona doc under shared LTM asserts the rendered block never carries that doc under the first-person instruction; a same-persona doc still renders verbatim when the personality is off the allowlist.
Release: joins beta.225 by owner decision (2026-09-16), as the narrow split-mode-for-foreign-notes fix only; the allowlist itself is not widened in that PR.
<!-- SECTION:DESCRIPTION:END -->
