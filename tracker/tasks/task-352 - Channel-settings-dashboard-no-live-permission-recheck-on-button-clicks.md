---
id: TASK-352
title: 'Channel settings dashboard: no live permission recheck on button clicks'
status: Done
assignee: []
created_date: '2026-07-29 12:32'
updated_date: '2026-07-30 12:07'
labels:
  - 'origin:review'
dependencies: []
priority: medium
ordinal: 352000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Manage Messages is checked once at dashboard-open (handleChannelSettings); subsequent button clicks (set AND the new reset) rely only on session.userId ownership. A moderator whose permission is revoked mid-session can still mutate channel overrides until the session expires — and reset (clear ALL overrides, #1854) has a bigger blast radius than a single set. Pre-existing class for set; surfaced by #1854 review.
Fix shape: re-check member.permissions.has(ManageMessages) in the channel dashboard update/reset handlers (interaction.member is available on guild button interactions), reply permission-denied on failure. Bounded today by the session TTL and invoker-only ownership, hence not urgent.
<!-- SECTION:DESCRIPTION:END -->
