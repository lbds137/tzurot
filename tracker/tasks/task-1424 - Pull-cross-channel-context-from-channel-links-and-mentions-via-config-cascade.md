---
id: TASK-1424
title: >-
  Pull cross-channel context from channel links and <#channelId> mentions via
  config cascade
status: To Do
assignee: []
created_date: '2026-11-14T19:26:39Z'
labels:
  - area:bot-client
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1424000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Owner feature request (2026-11-14): when a user sends a channel link (or `<#channelId>` channel mention, which Discord's client converts same-guild channel URLs into) to a character and the bot has access to that channel, pull recent messages from that channel into prompt assembly as a cross-channel reference — controlled via the 5-tier config cascade.

Verified codebase state:
1. **Message links only today:** `MESSAGE_LINK_PATH_PATTERN` (`packages/common-types/src/utils/discordInstanceOrigin.ts:165`), `MessageLinkParser` (`packages/common-types/src/utils/messageLinkParser.ts`), `MessageReferenceExtractor` (`services/bot-client/src/handlers/MessageReferenceExtractor.ts`), and `HistoryLinkResolver` (`services/bot-client/src/utils/HistoryLinkResolver.ts`) require 3 path segments (`/channels/<guildId|@me>/<channelId>/<messageId>`). A 2-segment channel URL (`https://discord.com/channels/<guildId|@me>/<channelId>`, plus `ptb.`/`canary.`/`discordapp.com` and `DISCORD_INSTANCE_ORIGIN`) is not matched, and `<#channelId>` channel mentions (`DISCORD_PATTERNS.CHANNEL_MENTION` in `packages/common-types/src/constants/discord.ts:186`) are skipped without lookup (`services/bot-client/src/utils/personalityMentionParser.ts:251`).
2. **Existing cross-channel cascade settings are passive only:** `ConfigOverridesSchema` (`packages/common-types/src/schemas/api/configOverrides.ts:38-53`) has `crossChannelHistoryEnabled`, `crossChannelRenderMode`, and `crossChannelMaxMessages` for backfilling unused budget from stored user/character history across other channels, not on-demand context pull from an explicitly linked channel.
3. **Reusable dual-access security gate exists:** `LinkExtractor.verifyInvokerCanAccessSource` (`services/bot-client/src/handlers/references/LinkExtractor.ts:95-115,252-336` + `satisfiesPrivateThreadMembership` in `services/bot-client/src/utils/threadAccess.ts`) already enforces that BOTH the bot AND the invoking user have access to a referenced guild channel, thread, or DM (`docs/reference/architecture/epic-identity-hardening.md`).

What:
1. **5-tier Config Cascade setting** (`packages/common-types/src/schemas/api/configOverrides.ts` following the `"field #12"` checklist at lines `140-148`, gateway `config-overrides` routes, `ConfigCascadeResolver`, and all 4 settings dashboards via `services/bot-client/src/utils/dashboard/settings/settingsDataBuilder.ts`):
   - Add cascade control for channel-reference context pull (e.g. `channelLinkContextEnabled: boolean` and/or bounded `channelLinkMaxMessages` cap per referenced channel / within overall context budget; decide default `true` vs `false` and interaction with `maxMessages` budget).
2. **Channel link & `<#channelId>` parser** (`packages/common-types/src/utils/`):
   - Parse both 2-segment channel URLs (`https://(ptb.|canary.)?discord(app)?.com/channels/(@me|\d+)/(\d+)` and configured `DISCORD_INSTANCE_ORIGIN/channels/...`, ensuring negative lookahead/non-overlap with 3-segment message links `/channels/.../.../...`) and `<#(\d+)>` channel mentions (deduplicated by `channelId`, skipping the current channel since its history is already in context).
3. **Dual-access fetch & prompt injection** (`services/bot-client` -> `services/ai-worker`):
   - When enabled by the resolved cascade config for the turn, resolve each referenced channel/thread, verify **both** bot read permissions (`ViewChannel` + `ReadMessageHistory`) AND invoking-user access via `verifyInvokerCanAccessSource` (logging info-level security skip on denial, never leaking private/staff channels or another user's DM), fetch the recent N messages (respecting budget and formatting webhook/character speaker names consistently), and attach a labeled cross-channel reference block (`#<channelName>`) to the assembly payload.

Acceptance:
- Sending a message with `<#channelId>` or `https://discord.com/channels/<guildId>/<channelId>` (including `DISCORD_INSTANCE_ORIGIN` when configured) to a character when the cascade setting is enabled pulls bounded recent messages from that channel into prompt context as a clearly attributed cross-channel reference.
- Invoking user lacking access to the target channel (private channel, private thread without membership, inaccessible guild, or another user's DM) or bot lacking read access cleanly skips expansion with zero content leaked.
- 3-segment message links (`/channels/<guild>/<channel>/<message>`) continue to resolve as individual `[Reference N]` message references without also triggering a redundant whole-channel pull for the same URL.
- Cascade field satisfies all `configOverrides.test.ts` invariants (`HARDCODED_CONFIG_DEFAULTS`, `NULL_TERMINAL_FIELDS` if nullable, wire clearing, and `settingsDataBuilder.test.ts` across admin/personality/channel/user dashboards).
<!-- SECTION:DESCRIPTION:END -->
