---
id: TASK-226
title: calculateHistoryBudget doesn't reserve the response safety margin
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 226000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`calculateHistoryBudget` doesn't reserve the response safety margin — `ContextWindowManager.calculateHistoryBudget` (~:254) omits the RESPONSE_SAFETY_MARGIN_RATIO subtraction that `calculateMemoryBudget` applies — in the contention case the worst-case sum of prompt+message+memories+history can exceed the window by up to the margin. Bounded upstream by computeContextCap's 50% effective-window cap, so not manifesting; unify the margin accounting when the memory epic's budget refactor touches this (same family as the pre/post-truncation lens). **Promote when**: memory epic Phase 1b budget refactor, or any calculateHistoryBudget touch. Surfaced 2026-07-07 (PR #1530 review).

**Why:** Tightens the same shared-space accounting item 7 fixed.

## Merged from TASK-448 (2026-10-12)

Survivor choice: kept TASK-226 (priority medium) as the umbrella for prompt-budget accounting; TASK-448 and TASK-450 were priority low.

TASK-448: the chat_log role legend ships in every prompt charged to no budget. `buildChatLogSection` (PromptBuilder.ts:73-83) emits a role-legend instruction paragraph that interpolates the personality name, roughly 330 chars / 75-85 tokens. Nothing budgets for it: the history selection loop reserves only `countTextTokens("<chat_log>\n</chat_log>")` (ContextWindowManager.ts:150, the bare tags), and `systemPromptBaseTokens` is measured with serializedHistory omitted (ContentBudgetManager.ts:373-376) where `buildChatLogSection` returns an empty string (PromptBuilder.ts:74-76), so base never sees it either. Net: every request ships ~80 tokens no budget accounted for; harmless while trimming is dormant (TASK-447, tens of thousands of tokens of headroom), a real off-by-one the moment the budget binds. Also unaccounted: the newline joiner between history entries (conversationUtils.ts:328, messages.join), roughly 1 token per entry. Fix shape: include the rendered legend in the wrapper-overhead reservation at ContextWindowManager.ts:150, or fold it into systemPromptBaseTokens; keep ONE measurement path (TASK-370 directive: no second render lever). Digest pass 2026-09-04 re-confirmed `wrapperOverhead` still charges only the bare tags but could not verify the flag-on base-token path (inconclusive, not asserted fixed). Surfaced 2026-08-06 by the Phase-2 windowing grounding sweep.

## Merged from TASK-450 (2026-10-12)

TASK-450: record `systemPromptBaseTokens` in the diagnostic payload; budget inputs are not recoverable once trimming starts. The diagnostic tokenBudget payload records POST-assembly totals, not the budget inputs: `systemPromptTokens` is the FINAL system message (contains the rendered chat_log), not `systemPromptBaseTokens` (history omitted, ContentBudgetManager.ts:373-380); `currentMessageTokens` is the FINAL human message including volatile prefix plus selected memories and facts, not the pre-memory value the budget used. On 2026-08-06 the inputs were recovered algebraically (base = systemPromptTokens - historyTokensUsed; cur = currentMessageTokens - memoryTokensUsed - factTokensUsed), valid only because historyMessagesDropped was 0 on every row; once trimming starts the reconstruction silently breaks, exactly when headroom analysis is wanted (it already cost two phantom branch-classification queries). Fix shape: record `systemPromptBaseTokens` (ideally also the pre-memory currentMessageTokens and `historyTokensFetched`) as their own fields in `DiagnosticTokenBudget`; small additive change in `DiagnosticCollector.recordTokenBudget` and callers; the UI need not display them. Bonus: headroom-to-trimming becomes directly computable. Digest pass 2026-09-04: `DiagnosticTokenBudget` (services/ai-worker/src/services/diagnostics/DiagnosticTypes.ts) still lacks these fields. Surfaced 2026-08-06 by the Phase-2 windowing analysis.
<!-- SECTION:DESCRIPTION:END -->
