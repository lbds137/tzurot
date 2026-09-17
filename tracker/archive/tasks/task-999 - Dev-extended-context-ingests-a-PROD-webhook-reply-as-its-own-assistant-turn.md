---
id: TASK-999
title: Dev extended context ingests a PROD webhook reply as its own assistant turn
status: To Do
assignee: []
created_date: '2026-09-17 15:13'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 995000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-17 the owner tagged prod Emily once in a dev test thread (request a7dd7486-d350-4e7f-9dcd-5158e3a8612b, debug export in docs/local/handoffs); the dev prompt then carried the prod reply as an ASSISTANT message (assembledPrompt.messages[3], role assistant, header [Emily — 10:59]) on every later dev turn in that thread. Cross-environment contamination of the character-own-prose kind that doc-97 is trying to remove; it also breaks any probe run in a channel both bots answer.
Expected: DiscordChannelFetcher.classifyAuthorship (services/bot-client/src/services/DiscordChannelFetcher.ts) marks a webhook message ours only on a registry hit (redisService.getWebhookPersonality) or a bot-suffix match (stripBotSuffix against deriveBotSuffix of the client tag). Dev derives the suffix from Rotzot · תשב and the prod reply carried Emily · שבת, so the suffix arm should miss; the registry arm is the open question (does dev Redis know a prod message id?).
Fix shape: probe first — log which arm matched (registry vs suffix) for the message id in the export, on dev; then either scope the registry key by environment or tighten the suffix compare. Pin with a fixture: a webhook message with a foreign suffix and no registry entry classifies as not ours (role user), and the seam test asserts the role that reaches the prompt.
Acceptance: a prod webhook reply in a shared channel renders in the dev prompt as a user-role message from another participant, never as the character assistant turn; the mechanism that matched is named in the PR body from a runtime observation, not a code read.
<!-- SECTION:DESCRIPTION:END -->
