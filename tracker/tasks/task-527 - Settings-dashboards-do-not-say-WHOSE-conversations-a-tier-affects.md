---
id: TASK-527
title: Settings dashboards do not say WHOSE conversations a tier affects
status: To Do
assignee: []
created_date: '2026-08-11 18:37'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 527000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: user request from Xeo (Discord #general, 2026-08-11): "Is it possible to change the global bot memory setting to 100? I saw that it can be done in the personal settings, but I think that only applies to my messages." The user could not tell from the UI which tier a setting governs, and reached for the wrong one. The five-tier cascade (hardcoded < admin < personality < channel < user-default < user+personality) is invisible from inside any single dashboard: /settings, /channel settings and the character dashboard all render the same MEMORY_SETTINGS list with the same wording.

What: give each settings dashboard a one-line scope statement in the embed - who and what the tier covers, and which tier overrides it. Wording is owner taste; the mechanism is shared (utils/dashboard/settings/) so one edit covers every level. Consider also naming the tier that is currently winning for a given field, since the resolver already computes it.

MODERATOR REFRAME (owner, 2026-08-11): the requester was asking as a server moderator, which makes the missing sentence sharper than "which tier is this". The moderator-relevant fact is that the channel tier is BELOW both user tiers, so a channel value is a default for users who never set the field and is silently overridden for everyone else. The scope line must therefore state the override direction, not only the scope - "applies to members who have not set their own" rather than "applies to this channel". Capability half is TASK-529.

Acceptance: a user reading one dashboard can tell whether the value they are about to change affects only their own conversations, the channel, or everyone.
<!-- SECTION:DESCRIPTION:END -->
