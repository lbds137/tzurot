---
id: TASK-683
title: Three hand-copies of the history-entry shape drift independently
status: Done
assignee: []
created_date: '2026-08-19 17:02'
updated_date: '2026-08-22 03:25'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 683000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the same conversation-history row shape is declared three times by hand, and each copy drifts behind the producer silently. The compiler cannot help, because a NARROWER declaration is assignable — a consumer reading a field the copy omits sees undefined at the type level while a real value flows at runtime.

The three:
1. RawHistoryEntry — services/ai-worker/src/jobs/utils/conversationTypes.ts:46, the fullest declaration.
2. The inline shape on ConversationContext.rawConversationHistory — services/ai-worker/src/services/ConversationalRAGTypes.ts. Its own doc comment records having been bitten by exactly this: personalityId/personalityName were added because their absence "made a populated field invisible to this path", and the remaining fields were added at the same time on the reasoning that the gap was never specific to those two.
3. PromptHistorySource — services/ai-worker/src/jobs/handlers/pipeline/steps/ContextStep.ts:100. Third instance of the same bug, found and fixed in PR #2150: it omitted personalityId, so extractCharacterParticipants over that array looked sibling-less to the compiler while carrying real ids at runtime.

All three describe rows produced by ONE writer: mapToConversationMessage in ConversationMessageMapper.ts.

Fix shape: make the two narrow copies derive from RawHistoryEntry rather than restate it — Pick<RawHistoryEntry, ...> where a genuine narrowing is wanted, or the type itself where it is not. The inline shape on ConversationContext is the harder half (it is a structural type in a widely-imported interface), so scope the work rather than assuming a one-line change.

Acceptance: adding a field to the producer cannot leave a consumer path unable to see it; no hand-restated copy of the row shape remains, or each surviving one is a Pick/Omit of the canonical type.
<!-- SECTION:DESCRIPTION:END -->
