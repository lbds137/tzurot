---
id: TASK-1143
title: 'inspect lookup: Discord link regex misses discordapp.com links'
status: To Do
assignee: []
created_date: '2026-09-28 02:36'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/inspect/lookup.ts:35 MESSAGE_LINK_REGEX is /discord\.com\/channels\/(?:@me|\d+)\/(\d+)\/(\d+)/, a hand-rolled copy separate from the common-types shared fragments (DISCORD_HOST_PATTERN / MESSAGE_LINK_PATH_PATTERN in packages/common-types/src/utils/discordInstanceOrigin.ts, single-sourced in PR #2554). A pasted discordapp.com message link is not recognized as a message link (code-reading; not runtime-confirmed). ptb/canary match only by substring. Its schemeless leniency (a bare discord.com/channels/... paste) is deliberate for user input.

What: accept discordapp.com too, preferably by composing from the shared path fragment with an optional-scheme host prefix; the group index read at the call site (linkMatch[2]) moves to [3] with the shared path groups.

Acceptance: parseIdentifier returns messageId for discord.com, discordapp.com, ptb./canary. links with and without https://; existing lookup tests pass unchanged.
<!-- SECTION:DESCRIPTION:END -->
