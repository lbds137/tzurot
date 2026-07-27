---
id: TASK-14
title: 'langchainConverter.convertConversationHistory attributes EVERY stored assistant row to…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels: []
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `langchainConverter.convertConversationHistory` attributes EVERY stored assistant row to the CURRENT personality (`formatAssistantMessageContent(msg.content, personalityName, …)` — it ignores the row's own `personalityName`) and maps them all to `AIMessage`. Today its output (`PreparedContext.conversationHistory`) is only COUNTED (MemoryRetriever log fields) — no model ever sees it, so no live bug — but any future consumer inherits sibling-lines-credited-to-self, the exact class the role="character" fix killed in the chat log. **Fix shape**: either delete the near-dead conversion path (knip can't flag it — it IS referenced) or fix attribution (use `msg.personalityName`, skip/mark sibling rows). **Promote when**: anything starts consuming `PreparedContext.conversationHistory` beyond counting, or next ContextStep rework. Surfaced during the sibling-persona role fix.

**Why:** A booby-trapped API: correct-looking history that silently mis-attributes sibling personas the moment someone uses it.
<!-- SECTION:DESCRIPTION:END -->
