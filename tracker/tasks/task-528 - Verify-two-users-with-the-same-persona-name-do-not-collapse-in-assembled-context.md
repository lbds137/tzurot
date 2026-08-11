---
id: TASK-528
title: Two users with the same persona name collapse into one participants entry
status: Done
assignee: []
created_date: '2026-08-11 18:37'
updated_date: '2026-08-11 22:08'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 528000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Xeo asked (Discord #general, 2026-08-11) whether history carries the account hashtag so the bot cannot mistake one person for another after a nickname change. The nickname half is answered by the code: user attribution goes through the persona, not the Discord nickname - packages/conversation-history/src/ConversationMessageMapper.ts:121 maps personaName from record.persona.preferredName ?? record.persona.name. A nickname change therefore cannot re-attribute anything.

The residual is the owner own caveat in that same reply - persona names could potentially clash - and it is worth one cheap check rather than an assumption. services/ai-worker/src/services/MemoryRetriever.ts:343 builds participantPersonas as a Map keyed by NAME, and ParticipantFormatter.ts:92 iterates that map, so if two different Discord users carry the same persona name the map key is shared. Whether that actually collapses two humans into one participant entry has NOT been traced end to end - the map may be built per resolved id upstream. Read the builder around MemoryRetriever.ts:342-380 and the formatter, then either close this as unfounded or file the fix.

What: trace it, and if the collapse is real, disambiguate the way the prompt layer already does elsewhere (MessageFormatters builds a disambiguated display name when a persona name collides with the personality name - same class, different pair).

TRACED 2026-08-11 — the collapse is REAL, and the dedup that looks like it should prevent it is aimed at the opposite direction.

MemoryRetriever.getAllParticipantPersonas (services/ai-worker/src/services/MemoryRetriever.ts:339-462), read in full:
- line 454: personaMap.set(participant.personaName, {...}) — the map is keyed by NAME, and the value carries content, pronouns, guildInfo and the resolved personaId.
- line 462: resolvedIdToName.set(resolvedPersonaId, participant.personaName) — the dedup index is keyed by personaId.
- lines 384-413: the dedup branch only runs when resolvedIdToName already holds THIS resolvedPersonaId. That is the same-user-two-names case (the comment at 352-354 says so: persona name from DB history vs longer display name from extended context), and it is handled well.

Two DIFFERENT users with the same persona name have different resolved personaIds, so line 384 misses, no dedup branch runs, and line 454 overwrites the first user entry with the second. The prompt then carries ONE participants block under that name - the second user content, pronouns and personaId - and the first user is silently absent. ParticipantFormatter.ts:92 iterates the map, so it renders whatever survived; nothing downstream can notice a lost entry.

This is the outcome the user feared, reached through a door the owner answer did not cover: not nickname re-attribution (that is genuinely impossible - attribution goes through the persona), but two humans collapsing into one identity block. Note MessageFormatters already disambiguates the persona-vs-PERSONALITY name collision; persona-vs-persona is unhandled.

Confidence: the keying is a deterministic property of the code and this is a full read of the builder, but no runtime observation is attached - the fix unit should open with a test that fails on the current code (two participants, distinct personaIds, identical personaName, assert both survive in the map).

Fix shape: key the map on resolvedPersonaId and carry the display name in the value, which also makes the existing name-preference heuristic a pure display concern; or, if the rendered name must stay unique, disambiguate at format time the way the personality-collision path does. The first is cleaner - the map is an identity index that happens to be keyed by a label.

Acceptance: a written answer either way, with the read that proves it; a real collapse gets its own fix task.
<!-- SECTION:DESCRIPTION:END -->
