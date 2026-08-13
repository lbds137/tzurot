---
id: TASK-587
title: >-
  Mention-char instructions hardcode @ while /help and BotMentionProcessor read
  BOT_MENTION_CHAR
status: To Do
assignee: []
created_date: '2026-08-13 12:54'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 587000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: NSFW_VERIFICATION_MESSAGE (utils/nsfwVerification.ts:165) and DMSessionProcessor.ts:311 both hardcode the @ sigil in user-facing instructions -- "@character_name hello" -- while BotMentionProcessor.ts:59 and commands/help/index.ts:88 read config.BOT_MENTION_CHAR for the same instruction. help/index.test.ts:479 explicitly exercises the & value, so per-deployment variance is designed for, not hypothetical. A deployment with BOT_MENTION_CHAR=& tells unverified and DM-session users to type a sigil that does not work, in the two messages that exist to teach them how to talk to the bot.

UNVERIFIED PREMISE, state it when picking this up: whether any deployment actually sets BOT_MENTION_CHAR to something other than the @ default. The Zod default is @ (config.ts:71). Check prod and dev Railway vars first -- if both are @, this is latent, not live, and the priority is right as filed.

Fix shape: both sites are module-level const template literals, which is presumably why they hardcode -- getConfig() at module-eval time is not safe. Convert each to a function taking the mention char (or reading config at call time, as BotMentionProcessor already does) and update callers plus the pinning tests (nsfwVerification.test.ts:331, DMSessionProcessor.test.ts:410).

Acceptance: no user-facing string hardcodes the mention sigil; grep for a literal @ inside instruction copy comes back empty or justified. Source: PR 2087 orchestrator finding while applying a claude-review terminology fix at the same line -- the reviewer flagged the noun, not the sigil.
<!-- SECTION:DESCRIPTION:END -->
