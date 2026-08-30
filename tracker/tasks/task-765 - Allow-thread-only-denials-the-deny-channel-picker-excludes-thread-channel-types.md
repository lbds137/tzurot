---
id: TASK-765
title: >-
  Allow thread-only denials - the /deny channel picker excludes thread channel
  types
status: Done
assignee: []
created_date: '2026-08-24 15:34'
updated_date: '2026-08-30 19:57'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 765000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner hit this live - a moderation target was active in a thread and the thread never appeared in the channel option autocomplete. The option restricts to GuildText/GuildVoice/GuildForum (services/bot-client/src/commands/deny/index.ts channel option addChannelTypes), so a thread-ONLY denial (deny in one thread while leaving the parent open) is unreachable. Parent-channel denials DO cover threads via the thread-to-parent inheritance in DenylistCache (the sequential scope check documents MUTE-overrides-parent-BLOCK), so the common case works - this is only about thread-granular denials.

Fix shape: add the thread channel types (PublicThread, PrivateThread, AnnouncementThread) to the channel option, then verify the enforcement path treats an explicit thread entry correctly (the inheritance code already reads an explicit thread entry before falling back to the parent, so it should be picker-only) and pin with a test that an explicit thread denial beats parent inheritance.

Acceptance: a thread is selectable in /deny add channel; an explicit thread-scoped denial blocks in that thread only; parent inheritance behavior unchanged.
<!-- SECTION:DESCRIPTION:END -->
