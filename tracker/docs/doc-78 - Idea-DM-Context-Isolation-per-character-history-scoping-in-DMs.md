---
id: doc-78
title: 'Idea: DM Context Isolation - per-character history scoping in DMs'
type: other
created_date: '2026-08-18 03:40'
---

## Origin

Owner intake 2026-08-18, relayed from a user: in DMs, a character is aware of the
whole DM channel history rather than only that user's conversation with that
specific character. Owner proposal: a config cascade option, "DM Context
Isolation".

## What the code actually does (verified, not assumed)

The owner asked whether we would need to track which character each history row
belongs to, and whether a multi-character message writes duplicate rows. Both
answered by reading the write and read paths:

- `conversation_history.personality_id` is NOT NULL on EVERY row, user turns
  included (prisma/schema.prisma:613). Rows are already per-character.
- A message tagging N characters already writes N user rows. Chain:
  `MultiTagCoordinator.submitSlot` (MultiTagCoordinator.ts:493) calls
  `PersonalityChatManager.submitChatJob` once per slot, and that method calls
  `saveUserMessage` (PersonalityChatManager.ts:168). Each row shares the same
  `discord_message_id` array and carries a distinct `personality_id`.

So the association the proposal wanted to add already exists. NO MIGRATION IS
REQUIRED.

## Where the leak actually is

Two read paths exist:

- `ConversationHistoryService.getHistory(channelId, personalityId, ...)` at
  ConversationHistoryService.ts:330 - personality-scoped, already isolated.
- `getChannelHistoryWindow(channelId, ...)` at
  ConversationHistoryService.ts:743 - channel-scoped, explicitly NO
  personality filter (its own doc comment says so).

`ContextAssembler` calls the channel-wide one UNCONDITIONALLY at
ContextAssembler.ts:224 - it is not gated behind an extended-context flag. That
is the mechanism behind the report.

## Fix shape

Read-side only: thread an optional `personalityId` predicate into
`buildChannelHistoryWhere` (ConversationMessageMapper.ts:129) and set it when
the cascade option is on. Scope the default to DMs (`guild_id IS NULL`);
channel-wide context is desirable in guilds, where the room is shared.

## Open product question (owner call, not technical)

With isolation ON and two characters tagged in one DM message, each character
sees its own copy of the user turn - that falls out of the per-character rows
for free. The undecided half is whether character A should see character B's
REPLY. Agent recommendation: no. Isolation that leaks the other character's
output is not isolation, and the strict reading costs nothing given the row
model.

## Unverified side observation - CHECK BEFORE REPEATING

Both rows are written and the channel window applies no DISTINCT, so a
multi-tag message looks structurally like it should appear TWICE in assembled
context today. This is a CODE READ, not a runtime observation - no assembled
prompt was inspected, and downstream dedup was not traced. Confirm against a
real prompt before stating it anywhere.

## Incidental upside

Per-character scoping removes a prompt-cache invalidation source: today another
character speaking in a shared DM churns the first character's cached prefix.
Adjacent to TASK-651 (S1 participants churn).
