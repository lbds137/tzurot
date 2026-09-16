---
id: TASK-992
title: Shared-LTM facts from other personalities render as the responding personality
status: Done
assignee: []
created_date: '2026-09-16 16:11'
updated_date: '2026-09-16 18:11'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 988000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: with shareLtmAcrossPersonalities on, retrieveFactsForPrompt passes a null personality to fact retrieval (services/ai-worker/src/services/factRetrievalHelper.ts, the shareLtmAcrossPersonalities ternary near line 62; FactStore null = ALL personalities, services/ai-worker/src/services/extraction/FactStore.ts near lines 148 and 213). formatSingleFact then resolves every {assistant} placeholder to the RESPONDING personality name (services/ai-worker/src/services/prompt/MemoryFormatter.ts, formatSingleFact). A commitment another character made would read as the responder own promise. Same class as TASK-991 (which fixed the memory_archive half), found by the TASK-991 orchestrator. Code-read only, not runtime-confirmed: a debug export with shared LTM on and a foreign-personality fact in the facts block would confirm it.
Fix shape: carry each fact row authoring personality into FactForPrompt, and in formatSingleFact resolve {assistant} to that personality name when it differs from the responder (or render such facts in a separate attributed group). Check TASK-974 first: retrieveFactsForPrompt already returns SimilarFact rows structurally, so the personality field may already ride along untyped.
Acceptance: a unit test with a foreign-personality fact under shared LTM asserts the rendered fact names its authoring personality, never the responder; own facts render unchanged.
Release: joins beta.225 by owner decision (2026-09-16) — shipping TASK-991 without it would be half the fix, since a foreign character commitments would still read as the responder own. Its own PR, dispatched after the #2439 G1/G2 fix unit reports (two concurrent worktree gate runs risk OOM on the Deck), based on #2439 or develop post-merge. TASK-974 folds in: the FactForPrompt contract is the same edit.
<!-- SECTION:DESCRIPTION:END -->
