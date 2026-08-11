---
id: TASK-526
title: Channel-wide conversation reset (all characters at once)
status: To Do
assignee: []
created_date: '2026-08-11 18:37'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 526000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: user request from Xeo (Discord #general, 2026-08-11): "Does the bot still not have a feature to reset a channel memory? I only saw that it can be done individually." Verified against the code, the ask is real: every clear/purge path is keyed (channelId, personalityId, personaId) and REQUIRES naming one character. services/api-gateway/src/routes/user/history.ts:321 calls retentionService.clearHistory(channelId, personalityId, personaId); /history clear and /history purge both take a required character option. So a user who has talked to six characters in a channel must run six resets.

What: an all-characters mode scoped to the current channel. Open shape questions for the owner (product taste, not an engineering call): (a) does it reset only the invoking user rows or every user in the channel; (b) permission gate - self-scoped needs none, channel-wide needs Manage Messages like /channel settings; (c) confirmation tier - design-system Tier B typed-phrase is the precedent for purge-class irreversible acts; (d) surface - a scope option on the existing /history purge vs a new subcommand.

Note the same user asked in the same message about channel-level SETTINGS, which do exist (/channel settings, Manage Messages, carries MEMORY_SETTINGS through the channel cascade tier) - that half is a discoverability gap, not a missing feature.

MODERATOR REFRAME (owner, 2026-08-11): the requester is asking as a Discord server MODERATOR, not as an individual user. That resolves open question (a) - the wanted scope is every user in the channel, not the invoker rows - and it shrinks the engineering shape, because the primitive already exists. ConversationRetentionService.clearHistory(channelId, personalityId, personaId) takes personaId as OPTIONAL (packages/conversation-history/src/ConversationRetentionService.ts:117-127): omit it and the where clause drops to channelId + personalityId, deleting every persona rows for that character in that channel, with memory propagation intact. So the service layer is already moderator-capable; what is missing is above it.

Remaining work, in order: (1) an authorization path - the only caller today is POST /api/user/history/clear, an actor-scoped user route, so a moderator action needs its own route with a permission check rather than a widened user route; (2) iteration across the characters active in the channel, since clearHistory is per-personality; (3) the bot-client command surface with a Manage Messages gate (same authority source as /channel settings - interaction.memberPermissions, NOT context.member.permissions, per the comment at commands/channel/settings.ts) and a Tier B typed-phrase confirmation, since this destroys other people conversations irreversibly.

Note the blast radius this reframe introduces: a moderator clearing a channel deletes rows belonging to users who did not ask and are not present. That is a product decision the owner owns - whether to do it at all, whether affected users are told, and whether the moderator scope is the whole channel or only characters the server itself activated.

THEME: member of doc-75 (Guild / Server Management), Phase 2. Read the theme before building - the moderator-authority question in its Phase 1 decides whether this clears only the invoker rows or everyone.

Acceptance: one invocation clears a channel conversation across every character the scope covers, with the confirmation tier the owner picks.
<!-- SECTION:DESCRIPTION:END -->
