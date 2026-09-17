# User-installable app — a second product surface

**Status**: research complete, not scheduled (owner direction 2026-09-17: "worth investigating … something I may want to follow up at some point"). Tracker theme `doc-105` owns the follow-up; the Phase C row in `backlog/cold/queue.md` carries the ordering.

**Summary.** Discord lets a user install an app on their account instead of a server. The app's commands then work in that user's DMs with other people, in group DMs, and in every server they are in, including servers where the bot was never invited. The app receives interactions only in those places: no message events, no channel reads, no webhooks. So this is not "Tzurot everywhere". It is a second surface with a different presentation layer, where characters speak through embeds instead of per-character webhooks, and where every feature is either a slash command the user types content into, or a context-menu command Discord hands a single message to. That is the same shape every popular user-installable app has converged on.

Every claim below was checked against the raw source of Discord's developer docs (`github.com/discord/discord-api-docs`, tree `e87d210`) and against the discord.js typings installed in this repo. Two conclusions are inferences assembled from several verified facts rather than a single quoted rule, and one preview-era limitation could not be confirmed either way; all three are marked.

## 1. What user install is (verified)

Two independent axes on every application command:

| Axis | Values | Default when omitted |
| --- | --- | --- |
| `integration_types` (installation context) | `GUILD_INSTALL` = 0, `USER_INSTALL` = 1 | `[0]` — guild install only |
| `contexts` (interaction context) | `GUILD` = 0, `BOT_DM` = 1, `PRIVATE_CHANNEL` = 2 | `[0, 1, 2]` |

`PRIVATE_CHANNEL` means "Group DMs and DMs other than the app's bot user" and is only meaningful when the command's integration types include `USER_INSTALL`. `BOT_DM` is the DM with Tzurot's own bot user, which is what Tzurot serves today; a `/chat` in a DM with a friend is `PRIVATE_CHANNEL`, not `BOT_DM`. Both fields apply to globally registered commands only, which is how Tzurot registers (`services/bot-client/src/utils/deployCommands.ts`, the `Routes.applicationCommands` PUT).

A user-installed app "is visible across all of an authorizing user's servers, DMs, and GDMs, but [is] forced to respect the user's permissions in the surface where the app is being used", and "apps installed only to a user can't take actions in a server". Enabling it for an existing app is a Developer Portal toggle plus a command re-registration, since apps created before mid-2024 (Tzurot) default to guild install only.

Sources: `resources/application` § Application Integration Types and § Installation Context; `interactions/application-commands` § Contexts; `tutorials/developing-a-user-installable-app`.

## 2. What the app receives and can do there

**Receives: interactions only.** Interactions arrive over the existing gateway connection and need no intent. `MESSAGE_CREATE` is intent-scoped to guilds the bot is in and DMs with the bot, so a DM between two humans, a group DM the bot is not a recipient of, and a server the bot is not a member of produce no message events. Reading messages by REST needs `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY`, which the app cannot hold there. _(Inference: Discord states no single sentence "user-installed apps receive no gateway events"; this is assembled from the intent list, the membership scoping, and the REST preconditions.)_ The one way to receive another person's message text is a **message context-menu command**, which delivers the full target message, content and attachments included, as a documented exception to the message-content intent.

**Every interaction carries** `context` (which of the three surfaces), `authorizing_integration_owners` (who installed the app: the guild id, the literal string `"0"` in the bot's own DM, or the installing user's id under the `USER_INSTALL` key), `app_permissions`, `channel_id`, and `attachment_size_limit`. The installer and the invoker are different fields, and "message component interactions can be triggered by any user the component is visible to, regardless of the installation context", so a button posted in a friend's DM can be clicked by the friend and the app can tell.

**Can send, inside the interaction only:** content, up to 10 embeds, files, components (including modals and Components V2), polls, and voice messages (`IS_VOICE_MESSAGE` with an `audio/` attachment carrying `duration_secs` and `waveform`). The 3-second initial-response deadline and the 15-minute token are unchanged. Ephemeral state is fixed at the first response and cannot be flipped afterwards.

**Hard limits, each with its source:**

| Limit | Consequence for Tzurot |
| --- | --- |
| Webhooks need `MANAGE_WEBHOOKS`; the (G)DM permission grant is exactly `ATTACH_FILES`, `EMBED_LINKS`, `MENTION_EVERYONE`; follow-ups reject `username` and `avatar_url` | **No per-character name and avatar** outside servers where Tzurot is installed. Character identity moves into an embed (author name + icon) or a content prefix, the way the bot-DM path already prefixes the display name. |
| **5 follow-up messages per interaction** when the app is user-installed and not installed in the server | Long replies must fit the initial response plus five follow-ups. A button is a new interaction with its own budget, so a "Continue" button is the clean workaround. |
| `USE_EXTERNAL_EMOJIS` is granted only in the bot's own DM | Character emoji from other servers render as text in friend DMs and group DMs. |
| `USE_EXTERNAL_APPS` is a server permission, on by default; when a server turns it off, responses from apps not installed there are forced ephemeral | A public character reply in someone else's server is never guaranteed. |
| No write path outside the interaction token: `Create Message` needs channel permissions, `Create DM` opens a DM with the bot, joining a group DM needs each member's OAuth `gdm.join` token | **The character can never speak first** in these contexts: no nudges, no chime-in, no scheduled messages. |
| No stickers in interaction responses; AutoMod can 400 the edit of a deferred response | Minor; handle the 400. |
| **UNVERIFIED**: the March 2024 preview listed "all follow-up messages are currently forced to be ephemeral in DMs"; the June 2024 GA note fixed the 25-member forced-ephemerality but never mentions this one | If still true, only the first message of a character's reply is visible to the friend. **Probe by hand before designing the DM-summon feature** (ten minutes with a throwaway app). |

Sources: `interactions/receiving-and-responding` (interaction object fields, response payload, § Create Followup Message, § Interactions and Bot Users); `events/gateway` (§ List of Intents, § Message Content Intent); `resources/webhook` § Create Webhook; `resources/message` § Get Channel Messages / § Create Message; `resources/user` § Create DM; `resources/channel` § Group DM Add Recipient; `topics/permissions` (`USE_EXTERNAL_APPS`, `MANAGE_WEBHOOKS`); `change-log` entries of 2024-03 (preview) and 2024-06-27 (GA).

**Scaling note.** There is no user-install-specific rate limit and no documented install-count cap. The threshold that matters is unchanged but sharpened: `MESSAGE_CONTENT` is a privileged intent, reviewed once "more than 10,000 unique users … can see your app across all the servers it's in", and user install is designed to make the app visible in many more servers. A user-install-only feature set needs no privileged intent at all, because its inputs come from command arguments and context-menu targets.

## 3. discord.js (verified against the installed copies)

Support landed in `discord.js@14.16.0` / `@discordjs/builders@1.9.0` (2024-09-01). Tzurot is on `discord.js@14.27.0`, `@discordjs/builders@1.14.1`, `discord-api-types@0.38.55`. The builder methods are `setIntegrationTypes(...ApplicationIntegrationType)` and `setContexts(...InteractionContextType)` on both `SlashCommandBuilder` and `ContextMenuCommandBuilder`; handlers read `interaction.context` and `interaction.authorizingIntegrationOwners` (a class from 14.27.0, with `.guildId` / `.userId` / `.guild` accessors). Three gotchas:

- In the bot's own DM, `authorizingIntegrationOwners.guildId` is the truthy string `"0"` while `.guild` is `null`; never truth-test the id.
- `interaction.channel` is `null` in a non-installed guild or a group DM unless `Partials.Channel` is enabled; use `interaction.channelId` and `interaction.reply()`, never `channel.send()`. _(Code-reading of `Action#getPayload`, not runtime-confirmed.)_
- In a non-installed guild `inGuild()` is true but `inCachedGuild()` is false, `guild` is `null`, and `member` is a raw API object with snake_case fields.

There is no official discord.js guide page for user installs (the guide documents `setContexts` only as a restriction).

## 4. Where Tzurot stands (code read 2026-09-17)

- **No command declares either field** (`grep setIntegrationTypes|setContexts|integration_types|contexts` over `services/` → 0), so every command ships as guild install only. `defineCommand` (`services/bot-client/src/utils/defineCommand.ts`) has no per-command flag for it.
- **A webhook-free render path already exists.** `DiscordResponseSender.ts` routes guild text channels to webhooks and everything else to a direct send that prefixes `**DisplayName:**`; chunking, TTS attachment, and message-id bookkeeping are shared. That direct path is the template, but it calls `channel.send()`; the user-install path must go through the interaction's reply and follow-ups and respect the five-follow-up cap.
- **The commands that already run in bot DMs are the natural first wave**: `/chat`, `/memory`, `/settings`, `/history`, `/inspect`, `/notifications`, `/feedback`, `/persona`, `/character`, `/shapes`. Only `/channel *` and the guild scopes of `/deny` require a guild (`requireManageMessagesContext`).
- **Environment resolution collapses every non-guild channel into one `dm` shape** (`services/bot-client/src/utils/discordContext.ts`); a group DM currently reads as a direct message. It needs a third arm keyed on `interaction.context`, and the prompt's `<location>` needs a group-DM rendering.
- **History keying survives intact.** Rows are keyed on `(channelId, personalityId, personaId)` with `guildId` null for DMs, and `channel_id` is on every interaction. "The character remembers this DM thread" works with no new plumbing. Do not key on recipients: the interaction's partial `channel` guarantees only `id` and `type`.
- **Unaffected**: bot-DM behaviour (message events with content still arrive there), the DM pre-warmers, the DM session processor, the retention notice DMs. Those all concern DMs the bot is a participant of.
- **Deferral is the load-bearing decision point.** `deferralMode: 'ephemeral'` is the default and exactly right for data commands anywhere, and exactly wrong for a character reply a friend should see. The context is known at interaction time, so the branch happens before the defer, inside the 3-second window.

## 5. Opportunities

Grouped by the wave they belong to; each names the mechanism it rests on and its biggest risk.

**Wave 0 — prerequisites, not features**

- **Spend gating.** User install multiplies the surface from "channels Tzurot is in" to "every server every installing user is in". Gate user-install chat on BYOK (`/settings apikey`, already shipped) or a small per-user allowance; make every quota key on user, never channel. Without this, user install is an uncapped spend multiplier.
- **A per-command flag in `defineCommand`** (`userInstallable: true`, the esmBot pattern) that drives both fields at registration, rather than a hand-maintained list. Default off; opt commands in one at a time.
- **The forced-ephemeral probe** (§2, unverified row) and the `interaction.channel` null check, both by hand on dev, before the DM-summon wave is designed.

**Wave 1 — zero-risk portability (data commands, all ephemeral)**

- `/memory`, `/settings` (including `data export` and `data delete`), `/persona`, `/character`, `/history`, `/inspect`, `/notifications`, `/feedback` from anywhere. Reuses everything as is. Data-rights access should not depend on being in the right server; this is the most defensible use of the surface. The export delivers as an attachment on the interaction response.
- **Per-context persona auto-selection**: `interaction.context` distinguishes guild, bot DM, and private channel, so a "work" persona could present in guilds and a private one in DMs. Risk: a silently swapped identity is worse than a manual one; needs an indicator and an opt-out. Owner taste.
- **`/shapes import` as an acquisition path**: someone sees a friend's character in a server Tzurot will never join, installs the app on their account, imports. Risk: growth outruns the privileged-intent review threshold.

**Wave 2 — a character in a DM with a friend, or a group DM**

- **Summon** via `/chat character message`: both see the reply; history keyed by the DM channel id gives continuity; the invoker's persona applies. Identity renders as an embed with the character's name and avatar. Reply length fits the initial response plus five follow-ups, with a **Continue button** for longer scenes (each press is a fresh interaction and budget).
- **Consent card**: on first summon in a DM, the character posts "Ada would like to join this conversation. [Allow] [Not now]" and only the *other* recipient's click enables it, provable because the clicker and the installer are separate fields. Reuses button routing and the denylist. This is the whole product-correctness question for the wave; get it wrong and Tzurot becomes a way to push an AI into someone's private DM.
- **Whisper mode**: an ephemeral `/chat` anywhere, private consultation with your own characters, zero moderation surface for the host server.
- **Voice-note replies**: TTS delivered as a native Discord voice message on the interaction response. Reuses voice-engine; risk is spend and the 15-minute token against synthesis latency, plus Discord's warning that the waveform encoding may change without notice.
- **Image input**: an `attachment` option on `/chat` runs the vision chain from anywhere. Risk: vision is the expensive path; the quota already exists and must key on user.
- **Character-authored polls** in a group DM: `poll` is an accepted response field. Small and verified.
- **Group-DM roleplay** falls out of the above rather than being its own goal: the character only ever sees what arrives through commands and context menus, never the room.

**Wave 3 — context-menu commands (the only way to read someone else's message)**

- **"Ask my character about this message"**: right-click any message in any server or DM, the app receives that one message with content, author, and attachments. Reaction, commentary, translation in character. The character comes from the user's default or a follow-up select, since context menus take no arguments.
- **"Remember this"**: the same mechanism feeding `/memory` and the fact store. **The sharpest privacy question in this document**: a third party's message, from a server where Tzurot has no presence and whose members never consented, ingested into a character's long-term store. At minimum record the author id and honour deletion transitively; consider storing only the user's own messages or an abstraction. This is an owner decision, not an engineering call.
- **In-character ghostwriting**: `/chat as:Ada text:"…"` shows an ephemeral rewrite with a "Send publicly" button that follows up publicly. Indistinguishable from the user typing it; impersonation and moderation concerns are real, and `USE_EXTERNAL_APPS` may force it ephemeral anyway.

**Not possible, with the reason** (§2 carries each citation): per-character webhook identity; mention-triggered, reply-triggered, or activated-channel behaviour in a non-installed server or a friend DM; the character speaking first; reading channel history for context; more than five follow-ups per interaction; stickers; external emoji outside the bot's DM; reactions or any moderation action; a guaranteed public reply in someone else's server; knowing who else is in a group DM.

## 6. What comparable apps do

Checked through Discord's public application-directory endpoint (`integration_types_config`, positive and negative controls run: carl-bot and AmariBot are guild-only) and each app's own docs. iTranslator, Scriptly, .fmbot, esmBot, and Translator Bot all document user install; none of them tries to read the channel. Every one uses the same three shapes: the user types the content as a command argument; a message context-menu command hands the target message over; guild configuration is replaced by a per-user settings command usable anywhere. Server-scoped features are excluded from the user-install set wherever the split is documented. esmBot's per-command `userAllowed` boolean is the registration pattern to copy. **No popular AI-chat or roleplay app documents user install from a primary source**: the space is uncontested, and there is no precedent for the consent and moderation questions in Wave 3.

## 7. Build shape, when picked up

1. Developer Portal: enable the user installation context with the `applications.commands` scope; add the discord.js flag to `defineCommand`; re-register. A command with the flag off is unchanged.
2. A `SurfaceKind` (`guild` | `bot-dm` | `private-channel` | `external-guild`) derived from `interaction.context` and `authorizingIntegrationOwners`, threaded into the deferral decision, the environment builder, and the response sender.
3. The interaction-scoped sender: character identity as an embed author, chunking bounded by the follow-up budget, a Continue button for the remainder, TTS as a voice message where requested.
4. The history writer for interaction-originated turns (the `/chat` path already writes the user turn from the option; verify it also writes the assistant turn in DMs).
5. Wave 1 commands flagged on; Wave 2 behind the consent card and the spend gate; Wave 3 behind an owner ruling on third-party content.
6. Privacy policy: one sentence on what a user-installed Tzurot can and cannot see, and the Wave 3 storage rule once decided.

**Open decisions for the owner**: the spend policy (BYOK-only vs allowance); whether a summoned character may store anything from a DM beyond the invoker's own text and the reply; whether "Remember this" on other people's messages is allowed at all; whether per-context persona switching is wanted. None of these blocks Wave 0 or Wave 1.

## 8. Related

- `doc-104` (persist channel and guild metadata): unrelated mechanism, but a user-install `/chat` in a group DM is another consumer of "what is this place called".
- `docs/proposals/backlog/message-actions.md`: the context-menu surface, if that proposal is still current, is the natural home for Wave 3's commands.
- The legacy scouting bullet in tracker `doc-53` is absorbed here.
