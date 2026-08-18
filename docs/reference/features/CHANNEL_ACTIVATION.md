# Channel Activation Feature

Channel activation lets server moderators designate one character to respond
automatically in a channel. Once activated, that character replies to every
message in the channel without needing an `@`-mention.

## User Commands

All four subcommands live under `/channel` and defer ephemerally.

### `/channel activate`

Activates a character in the current channel.

- **Option**: `character` (required, autocompleted).
- **Permission**: `ManageMessages` in the channel (`requireManageMessagesContext`).
- Only one character can be active per channel — the channel's settings row is
  unique on `channel_id`, so activating a new character replaces the previous
  activation rather than stacking.
- Private characters can only be activated by someone who can access them.

### `/channel deactivate`

Clears the channel's activated character. Idempotent — succeeds whether or not
anything was active. Same `ManageMessages` requirement.

### `/channel browse`

Paginated browse over activated channels.

- **Options**: `query` (search by character name), `filter` (`This Server` /
  `All Servers`, the latter owner-only).

### `/channel settings`

Opens the channel's extended-context settings dashboard. Channel settings are
also the **channel tier of the config cascade** — the `config_overrides` JSONB
column on the same row sits between the personality and user tiers.

## How It Works

### Message processing chain

Messages flow through a Chain-of-Responsibility built by `buildProcessorChain`
in `services/bot-client/src/composition.ts`. Order matters — first match wins:

1. `BotMessageFilter` — drop bot-originated messages
2. `DenylistFilter` — silently drop denied users/guilds/channels
3. `EmptyMessageFilter` — drop empty messages
4. `VoiceMessageProcessor` — transcribe voice; stashes the transcript for later stages
5. **`PersonalityTriggerProcessor`** — reply + activation + mentions → fan-out
6. `DMSessionProcessor` — bare DM messages → the active session character
7. `BotMentionProcessor` — the bot itself was `@`-mentioned (fallback)

Activation is **not** its own processor. `PersonalityTriggerProcessor` resolves
all three trigger sources in parallel and hands an ordered slot list to
`MultiTagCoordinator`, which owns delivery from there:

| Slot | Source     | `isAutoResponse` |
| ---- | ---------- | ---------------- |
| 0    | reply      | `false`          |
| 1    | activation | `true`           |
| 2..N | mentions   | `false`          |

That ordering is what makes an explicit reply outrank the ambient channel
default while `@`-mentions of other characters still work in an activated
channel. Slots are deduped by personality id, so a character that is
simultaneously the reply target and the activation produces one response, not
two. The list is capped at the multi-tag maximum; the coordinator is told when
the cap truncated candidates.

Behaviors worth knowing:

- **Threads inherit from their parent** — but only when the thread has no
  settings row at all. A thread with an explicit row and a null personality
  means "explicitly deactivated" and is respected over parent inheritance.
- **Forwarded messages fire activation only.** Reply and mention resolution are
  skipped, because a forward carries no webhook-reply relationship and its text
  was authored by the original sender.
- **Activation is guild-only.** DMs have no channel-level activation; bare DM
  messages fall through to `DMSessionProcessor`.
- **Discord's reply-ping toggle has no effect on characters.** Discord shows
  the `@ON`/`@OFF` control when you reply to a character, but characters post
  through webhooks, and Discord never records a webhook author in a message's
  `mentions` — measured at 0 of 521 real webhook replies against 276 of 1318
  for replies to humans, across 240 channels. The toggle state is discarded
  before it reaches us, so there is nothing to honor and no gate can be built
  on it. To quote a character's message _without_ waking it, **forward** it
  instead of replying (runtime-confirmed: a forward drew no response where five
  replies in the same window each did). In an activated channel this does not
  help — every message wakes the character, and a forward's accompanying
  comment arrives as a separate plain message.

### Private character access

When the activated character is private and the message author can't access it,
`loadPersonalityStrict` returns null and the activation slot is dropped — the
message simply continues down the chain, so the user can still `@`-mention
characters they do have access to.

They also receive a one-time explanatory reply, rate-limited to one notice per
user per channel per hour (`notificationCache.shouldNotifyUser`).

A gateway **failure** during resolution is deliberately distinguished from a
denial: a throw is caught, logged, and yields no activation slot _silently_.
Only a genuine "not accessible for this user" answer produces the notice.

### Storage

Activation lives on the `channel_settings` table (Prisma model
`ChannelSettings`), which also carries the channel's config-cascade overrides:

| Column                     | Meaning                                        |
| -------------------------- | ---------------------------------------------- |
| `channel_id`               | Discord channel snowflake, **unique**          |
| `guild_id`                 | Owning guild, nullable                         |
| `activated_personality_id` | The activated character; null = no activation  |
| `auto_respond`             | Defaults true                                  |
| `config_overrides`         | JSONB — the channel tier of the config cascade |
| `created_by`               | The user who created the row                   |

`activated_personality_id` is `onDelete: SetNull`, so deleting a character
deactivates it everywhere rather than cascading the settings rows away. Row ids
are deterministic UUIDs so the same logical row has the same id across
environments.

### API endpoints

| Endpoint                                        | Method           | Auth    | Description                              |
| ----------------------------------------------- | ---------------- | ------- | ---------------------------------------- |
| `/api/user/channel/activate`                    | POST             | User    | Activate a character in a channel        |
| `/api/user/channel/deactivate`                  | DELETE           | User    | Clear the channel's activation           |
| `/api/user/channel/list`                        | GET              | User    | List activations                         |
| `/api/user/channel/update-guild`                | PATCH            | User    | Backfill/repair the row's guild id       |
| `/api/user/channel/:channelId`                  | GET              | User    | Read one channel's settings              |
| `/api/user/channel/:channelId/config-overrides` | GET/PATCH/DELETE | User    | Channel-tier cascade overrides           |
| `/api/internal/channel/:channelId`              | GET              | Service | The read bot-client uses at message time |

The bot-client reads the **internal** variant during message processing (no user
context exists there) through the generated service client, behind a 30-second
`TTLCache` with pub/sub invalidation — see
`getChannelSettingsCached` in `bot-client/src/utils/gatewayServiceCalls.ts`.
"No settings" responses are cached too, so an inactive channel doesn't hit the
gateway on every message.

## Design Decisions

### One character per channel

Enforced structurally: `channel_id` is unique on `channel_settings` and
`activated_personality_id` is a single column. Multiple simultaneous characters
in one channel would produce competing responses to every message; users get
that behavior deliberately via `@`-mentions instead, which the multi-tag slot
mechanism already supports per message.

### `ManageMessages` to activate

Activation changes how a channel behaves for everyone in it, so it needs a
moderation-shaped permission — but not full admin. `ManageMessages` is the
permission servers already hand to moderators.

### Activation replaces rather than toggles

Switching characters is one command, not deactivate-then-activate, and the
replacement is a single row update so there is no intermediate state where the
channel is briefly unactivated.

### Not synced between dev and prod

`channel_settings` is in the sync-excluded set (`syncTables.ts`). Dev and prod
run different Discord bot instances; syncing activations would make both bots
auto-respond in the same channel.

## Related

- [`docs/proposals/backlog/multi-personality-support.md`](../../proposals/backlog/multi-personality-support.md) — multiple characters per channel
- [`docs/reference/architecture/model-selection-pipeline.md`](../architecture/model-selection-pipeline.md) — where the channel tier sits in config resolution
