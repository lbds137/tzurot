---
id: TASK-1563
title: >-
  getMessageByDiscordId resolves soft-deleted rows for the Chime In / Edit
  Character context menus
status: To Do
assignee: []
created_date: '2026-11-26T20:26:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1557000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2819 review (nit 7). getMessageByDiscordId (packages/conversation-history/src/ConversationHistoryService.ts) has no deletedAt filter, so a context-menu action on a reply the user deleted from history still resolves it; Chime In on a deleted turn is surprising. Reply resolution and DM session recovery share the function, so the filter must be scoped (a parameter or a separate query) rather than global.

What: decide per caller whether soft-deleted rows should resolve; for the two context-menu callers, treat a soft-deleted row as not a character reply (the existing ephemeral refusal).

Also (PR 2819 review round 4): the same findFirst has no orderBy, so if a Discord id ever appears on more than one row the pick is nondeterministic; add a deterministic orderBy (createdAt desc, id desc) in the same change.

Also (PR 2819 review round 6): a transient DB error reads as "That message isn't from a character." — getMessageByDiscordId catches every error and returns null, and lookupPersonalityFromMessage maps every non-ok result to null, so a gateway blip during a click shows a confident, wrong refusal. Distinguish 404 from other failures (e.g. `{ kind: 'not-found' } | { kind: 'error' }`) so the menus render a generic "try again" on the second case; the swallow predates the menus but they are a new user-facing consumer of it.

Acceptance: a test per context-menu action that a soft-deleted row is refused; reply resolution behaviour unchanged and pinned; the orderBy asserted in the service test.
<!-- SECTION:DESCRIPTION:END -->
