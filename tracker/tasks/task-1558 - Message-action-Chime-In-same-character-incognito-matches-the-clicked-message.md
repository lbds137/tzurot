---
id: TASK-1558
title: >-
  Message action: Chime In (same character, incognito matches the clicked
  message)
status: To Do
assignee: []
created_date: '2026-11-26T11:47:00Z'
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

Incognito record: incognito turns still write the ConversationHistory row (only LTM is skipped, ConversationalRAGService.ts:329-339), so persist incognitoModeActive as messageMetadata.incognito on the assistant row (Json column, schema.prisma:806; no migration; add the field to messageMetadataSchema, common-types types/schemas/message.ts). Read: a gateway lookup by discord message id returning personalityId, slug and incognito. Fallback for rows without the field: the footer regex for BOT_FOOTER_TEXT.INCOGNITO_MODE (common-types constants/discord.ts:818) on the fetched message; brittle (users can hide footers), old rows only.

Acceptance: clicking Chime In on an incognito message yields an incognito reply, on a normal one a normal reply; non-character messages get an ephemeral error; commands/ top-level file so check-commands-doc stays green, docs/commands.md mentions it.

Owner-confirmed 2026-11-26 (AskUserQuestion): behavior as described above; build for beta.252.
<!-- SECTION:DESCRIPTION:END -->
