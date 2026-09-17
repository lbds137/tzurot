---
id: TASK-1003
title: >-
  Render bot-DM character replies as a rich embed (name + avatar) instead of the
  bold-name prefix
status: To Do
assignee: []
created_date: '2026-09-17 22:12'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 999000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in a DM with the bot there are no webhooks, so DiscordResponseSender.sendViaDM prefixes every chunk with **DisplayName:** (services/bot-client/src/services/DiscordResponseSender.ts, rawContent line) and the reply carries the bot avatar, not the character. An embed with author name + icon and a per-character color restores the identity the webhook path has, and the same renderer is the ONLY identity mechanism available on the user-install surface (doc-105: no webhooks in friend DMs, group DMs, or non-installed servers), so building it once for bot DMs pays twice.
Owner question: replace the bold-name prefix in bot DMs with a character embed (author name + avatar + color, description as the body)?
Recommendation: yes, as its own PR behind a system setting for rollback, and make it the shared character-identity renderer doc-105 Phase 1 reuses. Watch-outs the PR must handle: embed description caps at 4096 chars (DISCORD_LIMITS.EMBED_DESCRIPTION) vs 2000 for content, so chunking changes shape; embeds render markdown in description but not in author name; a reply-to-embed still resolves by message id so reply detection is unaffected; TTS attachment rides on the last chunk as today; the (deduped x full) render matrix rule applies to the new arm.
Fix shape: a pure renderCharacterEmbed(personality, chunk, opts) in bot-client utils with a colocated test; sendViaDM picks embed vs prefix from the setting; a snapshot of one rendered embed; pnpm test:component if any command structure changes (it should not).
<!-- SECTION:DESCRIPTION:END -->
