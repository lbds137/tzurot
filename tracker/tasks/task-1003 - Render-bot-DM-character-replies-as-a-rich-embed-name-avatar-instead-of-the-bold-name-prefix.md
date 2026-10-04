---
id: TASK-1003
title: >-
  Render bot-DM character replies as a rich embed (name + avatar) instead of the
  bold-name prefix
status: To Do
assignee: []
created_date: '2026-09-17 22:12'
updated_date: '2026-10-04 23:07'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 999000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in a DM with the bot there are no webhooks, so DiscordResponseSender.sendViaDM prefixes every chunk with **DisplayName:** (services/bot-client/src/services/DiscordResponseSender.ts, rawContent line) and the reply carries the bot avatar, not the character. An embed with author name + icon and a per-character color restores the identity the webhook path has, and the same renderer is the ONLY identity mechanism available on the user-install surface (doc-105: no webhooks in friend DMs, group DMs, or non-installed servers), so building it once for bot DMs pays twice.
Fix shape: a pure renderCharacterEmbed(personality, chunk, opts) in bot-client utils with a colocated test; sendViaDM picks embed vs prefix from the setting; a snapshot of one rendered embed; pnpm test:component if any command structure changes (it should not).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): yes, as its own PR behind a system setting for rollback, built as the shared character-identity renderer doc-105 Phase 1 reuses; handle the 4096 embed cap, chunking, TTS on the last chunk, and the render matrix.
<!-- SECTION:NOTES:END -->
