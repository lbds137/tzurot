---
id: TASK-448
title: chat_log role legend ships in every prompt charged to no budget
status: To Do
assignee: []
created_date: '2026-08-06 23:46'
updated_date: '2026-08-07 16:23'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 448000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
buildChatLogSection (PromptBuilder.ts:73-83) emits a role-legend instruction paragraph that interpolates the personality name, roughly 330 chars / 75-85 tokens. Nothing budgets for it:

- The history selection loop reserves only countTextTokens("<chat_log>\n</chat_log>") — ContextWindowManager.ts:150 — i.e. the bare tags, not the legend.
- systemPromptBaseTokens is measured with serializedHistory omitted (ContentBudgetManager.ts:373-376), and buildChatLogSection returns empty string in that case (PromptBuilder.ts:74-76), so base never sees it either.

Net effect: every request ships ~80 tokens that no budget accounted for. Harmless while trimming is dormant (see TASK-447), because the budget has tens of thousands of tokens of headroom. It becomes a real off-by-one the moment the budget actually binds.

Related unbudgeted item found in the same sweep: the newline joiner between history entries (conversationUtils.ts:328, messages.join) costs roughly 1 token per entry, also unaccounted.

Fix shape: include the rendered legend in the wrapper-overhead reservation at ContextWindowManager.ts:150, or fold it into systemPromptBaseTokens. Prefer whichever keeps ONE measurement path — per the TASK-370 directive, do not add a second render lever.

Surfaced 2026-08-06 by the Phase-2 windowing grounding sweep.
<!-- SECTION:DESCRIPTION:END -->
