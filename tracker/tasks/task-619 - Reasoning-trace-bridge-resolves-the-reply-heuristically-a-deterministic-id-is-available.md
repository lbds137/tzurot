---
id: TASK-619
title: >-
  Reasoning-trace bridge resolves the reply heuristically; a deterministic id is
  available
status: To Do
assignee: []
created_date: '2026-08-15 15:48'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 619000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: historyReasoning.ts bridgeFromTriggerMessage resolves a trigger message to its reply with createdAt gt userRow.createdAt, orderBy asc, scoped to channel+personality+persona. Narrow race, flagged in review of PR 2105: two messages fired in quick succession in the same channel/personality/persona, where the user right-clicks the EARLIER trigger before its reply has persisted while the LATER reply already has, transiently returns the later reply trace instead of 404. Low severity (wrong-but-real trace, briefly) and the same shape as the existing tier-1 by-message to by-response fallback, so not a regression.

The better fix exists and is exact rather than heuristic: the assistant row id is deterministic, generateConversationHistoryUuid(channelId, personalityId, personaId, userMessageTime + 1ms), and conversationUserMessage.ts sets the user row createdAt to the Discord post time. If those are the same instant on every path, the bridge can findUnique the exact reply id and the race disappears.

BLOCKED ON A PRODUCER SWEEP, which is why PR 2105 did not do it: userMessageTime reaches saveAssistantMessage through several producers, including MultiTagRecovery reconstructing it from a serialized snapshot and the multiTagCoordinatorHelpers path. Per 00-critical the producer is authoritative, so the equivalence must be verified at every assignment site before relying on it. Getting it wrong is WORSE than the current state: an exact-id lookup that misses returns a permanent 404 where the heuristic succeeds, trading a narrow transient wrong answer for a durable missing one.

Fix shape: sweep every userMessageTime producer and confirm it equals the Discord post time; if yes, replace the second hop with findUnique on the derived id and add a component case for two rapid turns in one channel; if no, document why the heuristic stays and keep the ordering comment honest.

Acceptance: either the bridge does an exact id lookup with the sweep cited, or the heuristic is retained with the producer divergence named in the code comment.
<!-- SECTION:DESCRIPTION:END -->
