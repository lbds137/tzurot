---
id: TASK-528
title: >-
  Verify two users with the same persona name do not collapse in assembled
  context
status: To Do
assignee: []
created_date: '2026-08-11 18:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 528000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Xeo asked (Discord #general, 2026-08-11) whether history carries the account hashtag so the bot cannot mistake one person for another after a nickname change. The nickname half is answered by the code: user attribution goes through the persona, not the Discord nickname - packages/conversation-history/src/ConversationMessageMapper.ts:121 maps personaName from record.persona.preferredName ?? record.persona.name. A nickname change therefore cannot re-attribute anything.

The residual is the owner own caveat in that same reply - persona names could potentially clash - and it is worth one cheap check rather than an assumption. services/ai-worker/src/services/MemoryRetriever.ts:343 builds participantPersonas as a Map keyed by NAME, and ParticipantFormatter.ts:92 iterates that map, so if two different Discord users carry the same persona name the map key is shared. Whether that actually collapses two humans into one participant entry has NOT been traced end to end - the map may be built per resolved id upstream. Read the builder around MemoryRetriever.ts:342-380 and the formatter, then either close this as unfounded or file the fix.

What: trace it, and if the collapse is real, disambiguate the way the prompt layer already does elsewhere (MessageFormatters builds a disambiguated display name when a persona name collides with the personality name - same class, different pair).

Acceptance: a written answer either way, with the read that proves it; a real collapse gets its own fix task.
<!-- SECTION:DESCRIPTION:END -->
