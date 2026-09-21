---
id: TASK-960
title: >-
  Verify whether a second personality in the same channel sees the first one
  reply this turn
status: To Do
assignee: []
created_date: '2026-09-13 17:24'
updated_date: '2026-09-21 15:42'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 957000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shapes.inc shipped 2026-09-05 "each Shape sees replies already sent by other Shapes during that turn" as a fix, which means their multi-character turns were previously blind to each other. Whether Tzurot has the same blind spot is unknown — a one-grep look at services/ai-worker/src/services/context/ and jobs/utils/conversationUtils.ts on 2026-09-13 found no cross-personality same-turn handling either way. Adjacent to TASK-14 (langchainConverter attributes every stored assistant row to the current personality), which is about how OTHER personalities rows render, not whether the current turn reply of a sibling is present.
Fix shape: read-only check first — trace what conversation history a personality B loads when personality A already replied in the same channel seconds earlier (does the A reply row exist in conversation_history before B assembles, and does B history query include rows whose personalityId differs). Record the answer in this task. If B cannot see A, decide with the owner whether it should (chime-in and multi-character channels are the surfaces); only then file the build.
Acceptance: the task body states, with the file:line of the history query, whether a sibling personality same-turn reply is in context; a build task exists only if the owner wants the behaviour.

ANSWER (read-only trace 2026-09-21; cites verified against develop 2a0aa4d36): it depends on how the turn was triggered, and the two cases split exactly on the shapes.inc line.

- The history query is unscoped by personality under the default setting. channelHistoryHydration.ts:76-84 passes personalityId to getChannelHistoryWindow only when shouldScopeHistoryToPersonality returns true; the default shareHistoryAcrossPersonalities is 'always' (packages/common-types/src/schemas/api/configOverrides.ts:179), for which it returns false (configOverrides.ts:93-107), so buildChannelHistoryWhere (packages/conversation-history/src/ConversationMessageMapper.ts:152-160) filters on channelId and deletedAt only. A sibling row that EXISTS at assembly time loads, and it renders attributed to the sibling: participantUtils.ts:38-72 reads msg.personalityName from the row and resolveAssistantRowRole gives it role 'character', which RealMessagesBuilder.ts:90-96 emits as a HumanMessage. (The langchainConverter mislabel in TASK-14 is a telemetry-only path, not the generation prompt.) Pinned by the three isolation tests at ContextAssembler.test.ts:1563-1612.
- SEQUENTIAL turns (A replies, then the user pings B): B sees A. The assistant row is written by an awaited create in conversationAssistantMessage.ts:148-158 before that route responds at :189, and the bot-client only starts B afterwards.
- PARALLEL turns (multi-tag fan-out): B does NOT see A. MultiTagCoordinator.ts:168-172 submits every slot in one Promise.all, so all N jobs assemble their prompts before any sibling row exists; replies are buffered and delivered in slot order, but each is generated blind to the others. This is the same blind spot shapes.inc fixed. ContextStep.ts:255 and :555 carry race-window telemetry (a warn when a job was created under 500 ms after the newest assistant row) that would also fire on near-miss cases.

Owner question: in a multi-tag fan-out, should later slots be generated AFTER earlier slots complete so each character can see the replies already given this turn (serial, N times the latency), or stay parallel and blind as today?
Recommendation: stay parallel. The coordinator was built parallel with ordered delivery on purpose, a serial chain multiplies wall time and timeout exposure by the slot count, and no user report shows incoherent multi-tag turns. Revisit only on such a report; a cheaper middle ground then would be a one-line prompt note naming the other characters replying this turn, which is not a build to file today.
<!-- SECTION:DESCRIPTION:END -->
