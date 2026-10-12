---
id: TASK-450
title: >-
  Record systemPromptBaseTokens in the diagnostic payload — budget inputs are
  not recoverable once trimming starts
status: To Do
assignee: []
created_date: '2026-08-06 23:46'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:ai-worker'
  - 'area:observability'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 450000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The diagnostic tokenBudget payload records POST-assembly totals, not the inputs the budget was computed from:

- systemPromptTokens is the FINAL system message, which contains the rendered chat_log. It is NOT systemPromptBaseTokens (measured with history omitted, ContentBudgetManager.ts:373-380).
- currentMessageTokens is the FINAL human message including the volatile prefix plus selected memories and facts, not the pre-memory currentMessageTokens the budget used.

On 2026-08-06 the budgeting inputs were recovered algebraically for a prod analysis:
  base = systemPromptTokens - historyTokensUsed
  cur  = currentMessageTokens - memoryTokensUsed - factTokensUsed

That reconstruction is only valid because historyMessagesDropped was 0 on every row, which makes historyTokensUsed equal to the full fetched history. The moment trimming actually starts — the exact moment anyone would want to analyse budget headroom — used history stops equalling fetched history and the reconstruction silently breaks. The analysis becomes impossible precisely when it matters.

It also cost real errors: two successive branch-classification queries produced phantom results before the double-counting was spotted.

Fix shape: record systemPromptBaseTokens (and ideally the pre-memory currentMessageTokens, plus historyTokensFetched) as their own fields in DiagnosticTokenBudget. Small additive change in DiagnosticCollector.recordTokenBudget and its callers. The UI need not display them.

Bonus: with historyTokensFetched present, headroom-to-trimming becomes directly computable per request instead of derived.

Surfaced 2026-08-06 by the Phase-2 windowing analysis.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost (budget-headroom analysis becomes impossible exactly when it matters, and already cost real analyst time per the task). `DiagnosticTokenBudget`'s type still has no `systemPromptBaseTokens` field. Evidence: `grep -n "systemPromptTokens\|currentMessageTokens\|systemPromptBaseTokens" services/ai-worker/src/services/diagnostics/DiagnosticTypes.ts` → only `systemPromptTokens` and `currentMessageTokens` present; no base/pre-memory/fetched fields.
---
<!-- COMMENTS:END -->
