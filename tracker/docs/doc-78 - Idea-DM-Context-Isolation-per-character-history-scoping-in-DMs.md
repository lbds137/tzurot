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

## DECIDED by the owner 2026-08-18 — strict isolation, all or nothing

With isolation ON and two characters tagged in one DM message, each character
sees its own copy of the user turn - that falls out of the per-character rows
for free. The undecided half is whether character A should see character B's
REPLY. Agent recommendation was: no. **The owner agreed** — quote: "it should be all
or nothing. a small optional convenience for people who use DMs a lot (I don't
so I haven't dogfooded that path as much)".

So the shape is settled: when the option is ON for a DM, a character sees ONLY
its own rows in that channel — neither the other character's user-turn copies
nor its replies. Default OFF; this is an opt-in convenience, not a behavior
change for everyone. The owner flags that they do not use DMs much, so the path
is comparatively under-dogfooded — worth extra care on manual verification, and
worth asking the requesting user to confirm the result rather than assuming.

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

## Config shape — DECIDED 2026-08-18 (owner raised the objection that settled it)

The owner's objection: a single global boolean cannot express "isolate in DMs,
keep extended context everywhere else". Per-channel config does not rescue it —
DMs are one channel PER USER, so it would mean configuring each one, and every
new DM starts unset.

**Resolution: an enum, not a boolean.** Precedent already in the schema —
`voiceResponseMode: z.enum(['always', 'voice-only', 'never'])` at
configOverrides.ts:45 solves a structurally identical always/situational/never
problem.

```ts
shareHistoryAcrossPersonalities: z.enum(['always', 'guilds-only', 'dms-only', 'never'])
// HARDCODED_CONFIG_DEFAULTS: 'always'  (preserves current behavior)
```

The owner's case is `guilds-only`, set ONCE at the user tier: every DM isolates,
guild channels keep sharing, new DMs inherit it. The four values are the
complete lattice over two scopes, so nothing is arbitrarily omitted. The channel
tier still permits a single-channel exception.

Default `always` is a deliberate asymmetry with its two siblings
(`crossChannelHistoryEnabled` and `shareLtmAcrossPersonalities` both default
false): flipping this one to false would silently isolate every existing
conversation.

## The general problem, and its promote-when

Per-setting enums solve THIS instance with no new machinery, but every future
setting needing DM-vs-guild divergence re-invents its own value names.

The general fix is a **DM tier in the cascade** — a `dmOverrides` blob applying
to all DM channels, between the channel and user tiers — so any setting can
differ in DMs without becoming scope-aware itself. That is a 6th tier through
the resolver, schema, and UI.

**Promote when: a SECOND setting needs DM-vs-guild qualification.** At that
point the enum approach begins duplicating itself, which is the signal the
abstraction has earned its keep. Until then it is speculative.

## Implementation note — do NOT revert to the old read

The naive reading of "restore pre-extended-context behavior" would be to call a
personality-filtered read like the retired `getHistory`. That predates
beta.204's count-cap hysteresis and would reintroduce the per-turn cache churn
that release removed. Correct shape: add a `personalityId` predicate inside
`buildChannelHistoryWhere` (ConversationMessageMapper.ts:129), keeping the
window and its quantization intact.

## History — this axis was collapsed by a refactor, not designed away

`55d3b1bf8 fix(bot-client): use full channel history when extended context
enabled` introduced channel-wide reads, CONDITIONALLY. Two later commits —
`c41308d27 remove legacy extendedContext system` and `ebaa79551 consolidate
context settings into LlmConfig` — deleted the on/off flag and folded extended
context into plain config. No `extendedContextEnabled` field exists in
HARDCODED_CONFIG_DEFAULTS today, so the condition in that first commit's title
is gone and channel-wide became unconditional.

The resulting inconsistency, which is the real argument for this work:

| Sharing axis | Flag | Default |
| --- | --- | --- |
| History across CHANNELS | `crossChannelHistoryEnabled` | false |
| LTM across PERSONALITIES | `shareLtmAcrossPersonalities` | false |
| History across PERSONALITIES in a channel | none | always on |

Two of three sharing axes are opt-in; the third cannot be turned off.

## Incidental cleanup available

`ConversationHistoryService.getHistory` (ConversationHistoryService.ts:330) has
ZERO production callers — it backed the /history slash commands before they
migrated to typed clients, and only its own tests keep it alive. File-level
dead-code detection misses it because it is a method on a live class. The
isolation work touches this file; deleting it there is the natural moment.
Owner has not ruled on this yet.
