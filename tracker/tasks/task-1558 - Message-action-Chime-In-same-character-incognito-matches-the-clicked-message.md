---
id: TASK-1558
title: >-
  Message action: Chime In (same character, incognito matches the clicked
  message)
status: In Progress
assignee:
  - tzurot-a
created_date: '2026-11-26T11:47:00Z'
updated_date: '2026-11-26T11:59:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1552000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (11-26) wants characters to keep talking to each other without typing /chime-in each time; wanted in beta.252.

What: a message context-menu command "Chime In" on a character message runs the same turn as /chime-in character:<that character> in the same channel (runCharacterTurn, same denylist + NSFW gates). Incognito is sticky: incognitoOption = whether the clicked message was incognito.

Incognito record: incognito turns still write the ConversationHistory row (only LTM is skipped, ConversationalRAGService.ts:329-339), so persist incognitoModeActive as messageMetadata.incognito on the assistant row (Json column, schema.prisma:806; no migration; add the field to messageMetadataSchema, common-types types/schemas/message.ts). Read: a gateway lookup by discord message id returning personalityId, slug and incognito. Fallback for rows without the field (Lila 11-26): a long-term memory exists for the message -> not incognito; none -> incognito (fails toward privacy; deleted or superseded memories read incognito, accepted). Not for new rows: a deferred memory write (GenerationStep.ts:380) would misread a just-sent reply during rapid chaining. UNVERIFIED that memories carry the discord message id; if they do not, fall back to the footer regex (BOT_FOOTER_TEXT.INCOGNITO_MODE, common-types constants/discord.ts:818) instead.

Acceptance: clicking Chime In on an incognito message yields an incognito reply, on a normal one a normal reply; non-character messages get an ephemeral error; commands/ top-level file so check-commands-doc stays green, docs/commands.md mentions it.

Owner-confirmed 2026-11-26 (AskUserQuestion): behavior as described above; build for beta.252.

Fallback premise measured 2026-11-26 (PR 2819 review M2): memories DO carry Discord ids, but only the trigger (user) message's, never the reply's (LongTermMemoryService.ts messageIds: [triggerMessageId]; Railway-dev probe: 945/945 v3 memories in 30 days carry ids, all 945 join to role=user rows, 0 to assistant rows). Owner ruling (AskUserQuestion, "Footer, then memory"): for rows without the field, the incognito footer present -> incognito; otherwise the nearest preceding user row in the same channel+personality is the inferred trigger, and a memory for it -> not incognito, none -> incognito. Accepted cost: old replies with no user trigger (weigh-in / chime-in) read incognito. This also covers non-last chunks of an incognito reply, which carry no footer.

Refinement 2026-11-26 (AskUserQuestion, "Directly preceding", after the PR 2819 cross-family review): the inferred trigger counts only when it is the row IMMEDIATELY preceding the reply in the same channel+personality; if that row is another assistant reply, there is no trigger -> incognito. This delivers the accepted cost (old chime-ins read incognito); walking back to an earlier normal turn's user row would read them as normal.

Rulings 2026-11-26 (AskUserQuestion, after PR 2819 claude-review round 3): (1) "Keep sticky": a bare /chime-in defaults to incognito (characterTurn.ts incognitoOption ?? isWeighInMode), but the menu Chime In on a normal reply passes an explicit false and runs a normal turn with memories; kept as ruled, only the "as /chime-in" wording is corrected. (2) "Accept, note in PR": the lookup route exposing incognito/triggerMemoryExists for another user's turn is accepted, since the clicker learns the same bit from the resulting turn and incognito replies carry a visible footer.
<!-- SECTION:DESCRIPTION:END -->
