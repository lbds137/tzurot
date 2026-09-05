---
id: TASK-892
title: >-
  Bot leaving a guild (GuildDelete) orphans every user_guild_infos row for that
  guild
status: To Do
assignee: []
created_date: '2026-09-05 01:41'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 890000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2338 added the GuildMemberRemove path (a member leaves, their row is deleted through DELETE /api/internal/guild-member-info). The sibling case is the BOT leaving: bot-client has no GuildDelete listener (grep -rn GuildDelete services/bot-client/src --include=*.ts, non-test hits: 0; only GuildCreate is handled in services/bot-client/src/index.ts), so every row for that guild persists. Impact is storage only while the bot is out of the guild: nothing renders those rows unless the bot is re-added, at which point the record path refreshes them opportunistically, so stale roles can show for the first turn per member.

Fix shape: a GuildDelete listener in GuildMemberInfoReporter.ts calling a new service-only route DELETE /api/internal/guild-member-info/guild (body { guildId }) whose store function deletes by guildId alone (deleteMany on the guild column; bounded by nothing, which is fine for a whole-guild purge). Same codegen path as #2338: manifest entry in packages/clients/src/routes/internal.ts (that file is at 397 ESLint-counted lines, so split it first), handler-paths.ts line, conformance fixture, check-boundaries ban. Note GuildDelete also fires on outages with guild.unavailable set; skip those, only act on a real leave.

Acceptance: bot leaves a guild -> zero user_guild_infos rows remain for that guild; an unavailable-guild event deletes nothing (pinned).
<!-- SECTION:DESCRIPTION:END -->
