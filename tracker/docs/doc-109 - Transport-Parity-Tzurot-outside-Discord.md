---
id: doc-109
title: Transport Parity - Tzurot outside Discord
type: specification
created_date: '2026-09-30 04:32'
---

# Transport Parity — Tzurot outside Discord (doc-109)

Theme kickoff: Lila via Deck management, 2026-09-30 ~00:30; deputy driver while she is away:
Deck management (`dev-docs-66`). Fleet: **Tzurot driver** (this repo), **Spacebar server fork**
(`~/Projects/spacebar-server`; instance behind Caddy `:8443`, tailnet-only), **Machloket client**
(`~/Projects/machloket`). Goal: Tzurot runs against a non-Discord transport at feature parity.

This doc is the **Tzurot-side requirements artifact** the other two build against. Facts marked
**[as-exposed-today]** describe what the fork exposes as of 2026-09-28 (reported by the Spacebar
fork session, TASK-1137 notes) — the canonical API-contract home is decided separately when the
three analyses land (deputy ruling 2026-09-30).

Requirement IDs: **TR-n.m**. Owner tags: **[S]** Spacebar server fork · **[C]** Machloket client ·
**[S+C]** both · **[T]** Tzurot-side work (ours). Each section ends with what verifies it.

**Key structural fact (from the Appendix A inventory, 2026-09-30): bot-client is the ONLY process
that speaks Discord.** ai-worker has zero discord.js imports (it consumes DB-persisted message
envelopes + attachment URLs); common-types has only type-level/pure-helper imports; and there is
**no Discord voice-gateway code anywhere** — voice is voice-message attachments in, TTS files out.
Every [S]/[C] requirement below is therefore about ONE client process's surface (discord.js 14.27,
discord-api-types 0.38.55).

## What "runs outside Discord" means here

- Per-process, additive `DISCORD_INSTANCE_ORIGIN` — shipped as #2554 (`62962798e`, TASK-1137):
  a bot-client process with the origin set talks to the instance; unset = byte-for-byte Discord.
  "Both at the same time" (owner requirement, 2026-09-27) = two bot-client processes.
- Joint-boot topology (TASK-1137): REST base `<origin>/api` v10 **[as-exposed-today]**, gateway
  discovered via `/gateway/bot`, CDN at the origin root on the same port as `/api`
  **[as-exposed-today]**. Deck-local run: local containers, DB `tzurot_spacebar`, Redis `/1`.
- Tzurot's own surfaces do not move: api-gateway, ai-worker, voice-engine, and the DB are
  transport-agnostic except where TR-5 (CDN) touches ai-worker.

## TR-1 — Gateway & events

- **TR-1.1 [S]** The event set (Appendix A group 1 is authoritative): MESSAGE_CREATE,
  INTERACTION_CREATE, READY (complete: user, application, guilds **with channels and DM channels**),
  GUILD_CREATE, client Error, GUILD_MEMBER_UPDATE, GUILD_MEMBER_REMOVE, raw dispatches (the
  GatewayWatchdog timestamps every raw event), and shard-lifecycle payloads (ShardResume's
  replayed events, ShardReady's unavailableGuilds). A liveness probe does
  `guild.members.fetch({ query: '', limit: 1 })` and waits for the GUILD_MEMBERS_CHUNK response —
  query-based member fetch must work.
- **TR-1.2 [S]** Message payload field parity for the fields handlers read (Appendix A group 1
  tallies): author identity incl. `.bot`, channel + channel.type (14 channel types consumed),
  embeds (incl. `image.proxyURL` preference — see TR-5), content, `messageSnapshots` (26 read
  sites — forwards are load-bearing), `reference` (22 sites; `mentions.repliedUser` keys
  reply-personality resolution; TASK-954 documents it), guildId, components, attachments (10
  sites), createdAt/createdTimestamp (derived from the snowflake id — see TR-6.1), member,
  webhookId, type (13 MessageType members consumed), mentions, flags, stickers, poll,
  applicationId, partial.
- **TR-1.3 [S]** DM delivery. Two stacked mechanisms: (a) discord.js v14's MessageCreateAction
  **silently drops DM MESSAGE_CREATE when the channel is not cached** (`DMCacheWarmer.ts:4-15`
  documents it) — so READY (or an equivalent early point) must deliver the bot's DM channels;
  (b) Discord does not re-subscribe a bot to existing DM channels after gateway reconnect —
  `StartupDMPrewarmer` + `DMCacheWarmer` carry that on Discord today. The fork must pick and STATE
  one of: replicate Discord's shape exactly (warmers keep carrying it), or re-deliver DM channel
  subscriptions on READY/resume (root-cause fix; warmers become redundant but harmless). Silent
  divergence reproduces the "DMs silent" failure class (`.claude/rules/04-discord.md`).
  **Fork decision 2026-09-30: option (b)** — READY already builds DM channels from the
  recipients list (`Identify.ts:232,:626`), resume replays per-session buffered events incl.
  DMs (patch `7c69a3f10`, unit-tested); warmers redundant but harmless. Code-read; boot
  verifies the runtime shape.
- **TR-1.4 [S]** Resume + fresh IDENTIFY both deliver without loss: transient drops resume
  (session_id + resume gateway); process restarts IDENTIFY-fresh (deploys) and rely on TR-1.1's
  complete READY plus the startup warmers. Partials `[Channel, Message, User]` are configured
  specifically so DM MESSAGE_CREATE fires after restart — the server side must not assume the
  client holds pre-restart cache.
- **TR-1.5 [C]** DM interactions must reach the server with correct DM context (Machloket
  self-reported 2026-09-30: their client sent `guild_id "@me"` and the server refused; being fixed
  client-side). `DMSessionProcessor` + `nsfwVerification` depend on DM INTERACTION_CREATE **and**
  MESSAGE_CREATE both working. DMs are this bot's primary home — high priority.
- **TR-1.6 [S]** Intents configured: Guilds, GuildMessages, MessageContent, GuildWebhooks,
  DirectMessages, **GuildMembers (privileged)**. The server must emit everything these gate —
  content-bearing guild+DM messages, member add/update/remove — and must accept the privileged
  intent at IDENTIFY.

## TR-2 — Interaction lifecycle

- **TR-2.1 [S]** Interaction tokens with Discord-shaped validity: ack (defer) accepted within the
  3-second window; token usable for editReply/followUp ~15 minutes after. Tzurot's ack-state
  machine reads `interaction.deferred`/`replied`/`createdTimestamp` (18/13 reads) and its
  autocomplete handler self-budgets at 2500 ms against the 3 s ack — AI generation legitimately
  runs minutes, so post-defer validity is load-bearing. If fork windows differ, state numerically.
- **TR-2.2 [C]** Deferred state renders ("thinking…"); ephemeral responses (`MessageFlags.
  Ephemeral`, 255 uses) visible only to the invoker — server stores/delivers flags, client honors.
- **TR-2.3 [S+C]** The classified component/modal surface (Appendix A group 3): buttons; **string
  select menus only** (no user/role/channel-select interactions are used); modals with
  TextInputStyle Short/Paragraph **only** (no modal FileUpload input); message **context-menu
  commands** (`ApplicationCommandType.Message`, `targetId`); slash option types include
  **user, channel, role, mentionable, and attachment** (typedOptions wrapper) — the client's
  command-argument UI must render those pickers. **Components V2 is used** (character `viewV2`:
  IsComponentsV2 flag, Container/TextDisplay/MediaGallery/Section/Thumbnail/StringSelect/…; a
  FileUpload ComponentType appears in the CV2 mapping `embedComponents.ts:38-58` — Q11 confirms
  at boot whether a live command builds one). Machloket's self-reported gaps (modal FileUpload,
  entity selects) do NOT block Tzurot today — the entity gap that DOES bite is slash-option
  pickers + CV2 rendering.
- **TR-2.4 [S]** customId ceiling 100 chars — Tzurot encodes it in `DISCORD_LIMITS.
  CUSTOM_ID_MAX_LENGTH` and segments `customIdFamily.ts` against it (`command::action::params`,
  snowflake-carrying segments). Match the limit or state a larger one; never truncate silently.
- **TR-2.5 [S+C]** No collectors anywhere (`awaitMessageComponent`/`createMessageComponentCollector`
  zero hits) — ALL component routing survives restarts via the global CommandHandler on customId.
  The server must deliver INTERACTION_CREATE for any bot-sent message at any later time; no
  collector-TTL assumptions on either side.

## TR-3 — REST surface, webhooks, rate limits

- **TR-3.1 [S]** API v10 route parity for the discord.js calls of Appendix A group 2 (channel
  message send/fetch/edit/delete, reply, react, typing, channels/users/members fetch, createDM,
  presence, guild leave, fetchWebhooks/createWebhook/webhook.send) PLUS group 9 (command
  registration `PUT` guild-scoped when `GUILD_ID` set, global otherwise; a bare webhook-execute
  POST used by the watchdog alert — that one stays pointed at real Discord).
- **TR-3.2 [S]** Rate-limit signaling: Discord-shaped `X-RateLimit-*` headers + 429 with
  `retryAfter` — the typing classifier and error paths consume `error.retryAfter` (Appendix A
  group 10). `deployCommands` bulk-registers and paces on these headers.
- **TR-3.3 [S]** Discord v10 limits exactly (Tzurot's `DISCORD_LIMITS` table, Appendix A group
  10): message 2000, input 4000, embed title/description/field/footer caps, attachments ≤25 MiB
  and ≤10/message, autocomplete 25 choices × 100 chars, customId 100, modal title 45, modal input
  4000, avatar 10 MiB. Chunking math is written against these.
- **TR-3.4 [S+C]** **Webhooks are the primary personality-response path** (`WebhookManager`):
  `fetchWebhooks` + `createWebhook` (owner-matched, 100-cache), per-send `username` +
  `avatarURL` (instance-hosted avatar path) + `threadId` + `files` + `allowedMentions{parse:[]}`,
  webhook parent restricted to GuildText/GuildAnnouncement/GuildForum. Message identity in
  personality responses = webhook fields; the fork must implement all of it, and Machloket must
  render webhook-authored messages with the override name/avatar. DM responses go as normal
  bot messages (`DiscordResponseSender` duality).
- **TR-3.5 [S]** `allowed_mentions` honored per-send and globally (`parse: []` everywhere — ping
  suppression is a product requirement, not decoration); `repliedUser: false` on reply-paths.
- **TR-3.6 [S]** Discord numeric error codes: 10008 (Unknown Message), 10003 (Unknown Channel),
  50001 (Missing Access), 50013 (Missing Permissions), 10007 (Unknown Member — the private-thread
  gate relies on throw-for-non-member), 10013 (owner-gate DM path) — consumed as
  `(error as {code}).code`. Fork status 2026-09-30 (corrected): the enum HAS 10007 — the gap is
  the missing single thread-member GET route, which today returns a generic catch-all 404
  instead of 10007 (fix G3 queued; Q8).
- **TR-3.7 [S]** Typing indicator endpoint + reactions readable from fetched history
  (`reactions.cache`, `emoji.name`) and one `react('🔧')` maintenance ack.
- **Explicitly NOT needed** (scope reducers for the fork): bulkDelete, channel create/rename,
  role/ban/kick mutations, invites, emoji/sticker upload, audit log, sweepers, sharding config,
  any voice gateway (TR-4).

## TR-4 — Voice (attachments, not a voice gateway)

**There is no Discord voice-gateway dependency** — zero `@discordjs/voice` usage repo-wide
(Appendix A group 4). Voice in Tzurot is:

- **TR-4.1 [S+C]** Voice-message **attachments**: audio files attached to messages
  (`audio/*` contentType, `duration`, `waveform` metadata, and Discord's `IsVoiceMessage` message
  flag for the Vencord/Vesktop `video/webm` path). The fork's attachment objects must carry
  contentType/size/name/duration/waveform/spoiler; Machloket's client needs a voice-message
  upload path that sets the flag. `createdAt` ordering of voice turns rides TR-6.1.
- **TR-4.2 [T]** TTS output is files attached to webhook sends (TR-3.4) — no transport
  requirement beyond files. STT/TTS (`voice-engine`) is internal HTTP behind api-gateway; it never
  touches the transport.

(An earlier draft of this section assumed a @discordjs/voice connection; the inventory refuted it.
Q2 in the original open-questions list is obsolete.)

## TR-5 — CDN & attachments

- **TR-5.1 [S]** Serve CDN under the origin root on the instance port **[as-exposed-today: matches
  `discordRestOptions`]**, with routes under the 20 `DISCORD_INSTANCE_CDN_PATH_PREFIXES`
  (`/attachments/` verified against the fork's `src/cdn/routes/attachments.ts`; also `/avatars/`,
  `/emojis/`, `/stickers/`, `/icons/`, … — full list in `discordInstanceOrigin.ts:116-137`).
  `/api` is deliberately NEVER a CDN prefix — CDN and API must stay distinguishable by path.
- **TR-5.2 [S]** Payload URLs fetchable headlessly by ai-worker (no cookies, no client-bound
  session; `redirect: 'error'`; 403 read as expired-CDN signal). Signing is OFF
  **[as-exposed-today: `cdnSignUrls=false`]** — keep it off, or set `cdnSignatureIncludeIp` and
  `cdnSignatureIncludeUserAgent` false (bot-client and ai-worker differ in both). If signing is
  ever enabled, the `ex/is/hm` param scheme must match Discord's — `discordCdnExpiry.ts` parses
  it; unsigned URLs simply pass (no `ex` → not expired).
- **TR-5.3 [S]** `mediaProxy` is set to the origin (`discordRestOptions`) because @discordjs/rest
  builds GIF-sticker URLs from it — sticker URLs must resolve on the origin. Embed image
  extraction prefers `proxyURL` over `url` (`embedImageExtractor.ts`); if the fork does not
  rehost, set `proxyURL = url` (Q9).
- **TR-5.4 [T]** Message links: `messageLinkParser` accepts Discord hosts + the instance origin
  (#2554 landed that); instance-hosted links in raw content are rewritten ai-worker-side
  (`contentRewriter.ts`). No open peer work.

## TR-6 — Identity & snowflakes

- **TR-6.1 [S]** IDs must be **true Discord-epoch snowflakes**, not merely 17–20-digit strings:
  discord.js derives `createdAt`/`createdTimestamp` from the id internally **with Discord's
  epoch hard-coded** (fork finding 2026-09-30), and Tzurot relies on that (echo `createdAt`
  anchoring ~80 ms, forwarded-message timestamps, snowflake-time ordering of DB rows vs
  bot-observed snapshots). Validation everywhere is `^\d{17,20}$` (`DISCORD_SNOWFLAKE.PATTERN`);
  mentions parse as `<@!?id>`. Any epoch other than Discord's silently shifts every derived
  timestamp — instance ids MUST use Discord's epoch (fork does: `Snowflake.ts:15`).
- **TR-6.2 — REVERSED 2026-09-30 (fork push-back accepted)**: the original recommendation
  (custom epoch for collision isolation) contradicted TR-6.1 — discord.js's hard-coded epoch
  makes a custom epoch impossible without patching the client, and the only mixed keyspace is
  Tzurot's storage, not the server's. Collision isolation is Tzurot-side (the platform
  dimension in TASK-1138). Not a server requirement.
- **TR-6.3 [S+C]** User objects Discord-v10-shaped: id, username, globalName/displayName, tag,
  avatar, bot flag (bot-author filtering keys on `.bot`; webhook identity on `.webhookId`).

## TR-7 — Permissions

- **TR-7.1 [S]** Only three permission bits are checked — **ManageMessages** (purge + channel
  settings gates), **ViewChannel** + **ReadMessageHistory** (cross-channel link access, fail
  closed on null) — but they must carry Discord's **bit values** (`PermissionsBitField` compares
  numerically) and resolve through member role state that reaches the bot (GUILD_MEMBER_UPDATE,
  TR-1.1).
- **TR-7.2 [S+C]** Private-thread membership gate: `channel.members.fetch(viewerId)` must throw
  Discord's 10007 for non-members (TR-3.6) — the fork must enforce server-side, the client gets
  the same error surface. Fork current state: the route is absent → generic 404 today (Q8);
  G3 restores the 10007 shape.
- **TR-7.3 [S]** Owner override is Tzurot-internal (`BOT_OWNER_ID` + `isBotOwner`); no peer work,
  but the 10013 error-code path it rides is TR-3.6.
- **TR-7.4 [S+C]** NSFW state: `guild.nsfwLevel === AgeRestricted` and `channel.nsfw` on
  text/news/thread-parent must be present and accurate — the NSFW verification flow fails closed
  without it.

## TR-8 — Login, config, ops

- **TR-8.1 [S]** Bot-token auth (v10 Authorization shape), `/gateway/bot` discovery,
  Discord-shaped heartbeats, `client.ws.status` transitions the watchdog reads. A discord.js
  14.27 bot reached ClientReady on the instance 2026-09-27 17:06 **[as-exposed-today]** —
  login-level parity is proven; everything above this line is not yet.
  **Auth divergence (fork, 2026-09-30)**: USER login on the fork is email-only
  (`INVALID_LOGIN` on username; Discord accepts both) — affects Machloket's login UI and the
  boot-owner account, not the bot's TOKEN login.
- **TR-8.2 [S]** Presence: `setPresence`/`setActivity` with ActivityType Playing/Listening/
  Watching/Custom/Competing (persisted in Redis, restored at boot).
- **TR-8.3 [T]** Instance bot token + application id (Spacebar session provides); joint boot
  uses them per TASK-1137.

## TR-9 — Conformance process (owner hard line)

- **TR-9.1 [T]** TASK-1145: `pnpm ops` command deriving bot-client's discord.js surface from
  source → JSON + markdown + checked-in snapshot + CI check, so a PR that adds a primitive shows
  up as a snapshot diff. Until it exists, **Appendix A is the conformance list** (v1, manual,
  dated 2026-09-30) and the fork/Machloket sessions consume it from this doc.
- **TR-9.2 [T]** Owner hard line (2026-09-28): a UX wave that adds a primitive the fork never
  heard about is the failure mode. The snapshot check is the mechanical guard; until then this
  doc's Appendix A carries a dated revision header and gets re-derived on every UX-wave merge.

## Open questions

- **Q1 [S] — ANSWERED 2026-09-30 (code-read; boot confirms)**: ack window 3000 ms
  (`routes/interactions/index.ts:243` → `INTERACTION_FAILURE`), token lifetime 15 min
  (`util/imports/Interactions.ts:48`, unit-tested). Discord-shaped.
- **Q3 [S] — ANSWERED (code-read)**: `X-RateLimit-*` headers exist
  (`src/api/middlewares/RateLimit.ts`); exact 429 + `retry_after` shape verified at the boot.
- **Q4 [S] — DECIDED 2026-09-30**: server-side fix, do NOT replicate Discord's wart (see TR-1.3).
- **Q5 [S] — PUSH-BACK ACCEPTED 2026-09-30**: keep Discord's epoch; TR-6.2 reversed (see TR-6).
- **Q8 [S] — PARTIAL, corrected 2026-09-30**: full-set diff against the fork's
  `DiscordApiErrors` enum pending (list sent: 10003, 10007, 10008, 10013, 50001, 50013 +
  429/retryAfter). The enum DOES define `UNKNOWN_MEMBER`/10007 (`src/util/util/Constants.ts:547`
  — the earlier "missing from enum" claim was a mistyped grep path, retracted by the fork). The
  real gap: **the single thread-member GET route does not exist** —
  `GET /channels/{id}/thread-members/{user_id}` falls through to the catch-all and returns a
  generic 404 "Endpoint not found", never a Discord-shaped 10007. Fix G3 queued behind
  allowed_mentions; a runtime red probe on instance B gives the patch its before/after.
- **Q9 [S] — ANSWERED (code-read)**: attachments ALWAYS rehost — `proxy_url` built as
  `${cdnPublic}/attachments/<channel>/<message>/<file>` (`Attachment.ts:104`), always included.
  Embed images NOT rehosted (passthrough, usually undefined) — Tzurot's `proxyURL ?? url`
  fallback already handles both; no change needed.
- **Q10 [S] — ANSWERED (code-read)**: query-based member fetch supported incl. discord.js's
  empty-string-query quirk (`RequestGuildMembers.ts:42-53`); boot probe confirms the chunk.
- **Q11 [T]** Is a CV2 `FileUpload` component actually BUILT by a live command (viewV2), or only
  present in the mapping? Settle at the joint boot.
- Resolved by the inventory: ~~Q2 voice DAVE~~ (no voice gateway exists — TR-4); ~~Q6 CV2 used?~~
  (yes); ~~Q7 webhooks~~ (load-bearing — TR-3.4).

## Tzurot-side roadmap on this theme

1. This doc + Appendix A — **DONE 2026-09-30** (inventory pass; corrections over the first draft:
   voice is attachments-not-gateway; webhooks primary; error-code + snowflake-epoch requirements
   added).
2. TASK-1137 joint boot (Deck-local, DB `tzurot_spacebar` + Redis `/1`) with the Spacebar
   session — exercises TRs empirically, answers Q1/Q8/Q9/Q10/Q11.
   **Deputy ruling 2026-09-30**: the production `:3001` instance and spacebar-postgres data are
   OFF-LIMITS — the boot runs against a SECOND instance on another port with its own DB. Note
   for instance B: Tzurot's `normalizeDiscordInstanceOrigin` accepts https origins only, so
   instance B needs an https origin (Caddy route or another tailscale-serve port), not bare
   `http://127.0.0.1:<port>`. Tzurot-side prep DONE 2026-09-30: DB `tzurot_spacebar` created on
   tzurot-postgres and migrated (137 migrations, count verified); Redis `/1` wired at boot;
   RAM checked (8.1 GB available). Boot findings are recorded here with TR/Q IDs (deputy rule:
   the contract accumulates empirically, not just from static analysis). Machloket's
   `TzurotProbe` bot (row-9, `/row9` serving buttons/selects/modals, DM-capable since `6d4f9d6`)
   is the exerciser on the client side. TASK-1137 closes on the boot (both sessions agree).
   **Instance B up 2026-09-30**: `http://127.0.0.1:3002`, own postgres (container
   `spacebar-boot-postgres` :5434, db `spacebar`) — production `:3001` untouched. HTTPS origin
   `https://deck.tail00338f.ts.net:8444` pending a Tailscale Serve route (asked of Deck
   management); fallback = the fork's self-signed proxy + `NODE_EXTRA_CA_CERTS` on the bot
   process. Credentials (TzurotBot + TzurotProbeB, tokens verified 200 on `/gateway/bot`) live
   in the fork repo at `docs/local/boot-b/secrets.env` (mode 600, git-excluded) — read
   in-shell at boot time, never copied into this repo. Q8/10007 accepted by the fork as gap G3,
   queued behind the allowed_mentions patch.
3. TASK-1145 ops command + snapshot (turns TR-9.1 mechanical).
4. Gap analysis from the boot → PRs (Tzurot-side) / requirements deltas (peer-side).

## Coordination log

- **2026-09-30 ~00:30** Kickoff (Lila via Deck management): theme opened, fleet of three, this
  doc as the Tzurot requirements artifact. Deputy driver: dev-docs-66 while Lila is away.
- **2026-09-30 ~00:50** Deputy integration ruling: requirements written against the fork
  **as-exposed-today**, marked as such; canonical contract home decided when the three analyses
  land.
- **2026-09-30 ~01:00** Machloket self-reported client gaps (modal FileUpload, entity selects
  unbuilt; DM `guild_id "@me"` refusal being fixed) — folded into TR-1.5 and TR-2.3.
- **2026-09-30 ~01:40** Appendix A inventory landed (116 entries, 10 groups; zero-hit groups
  called out). TR-4 rewritten (no voice gateway), TR-3.4 webhooks promoted from open question,
  TR-6.1 strengthened to epoch semantics, Q2/Q6/Q7 resolved. Answers sent to Machloket (their
  classified list) and the conformance list pointed out to the Spacebar fork session.
- **2026-09-30 ~02:40** Deputy approved the joint boot with constraints (:3001 + spacebar-
  postgres off-limits; free -h before spawning; findings keyed to TR/Q ids). Tzurot-side prep
  done: `tzurot_spacebar` migrated (137).
- **2026-09-30 ~02:50** Spacebar fork answered from source: Q1 (3000 ms / 15 min), Q3 (headers
  exist), Q4 (server-side DM fix — TR-1.3 option (b)), Q9 (attachments always rehost; embeds
  passthrough — no Tzurot change), Q10 (query fetch supported); Q5 push-back ACCEPTED → TR-6.2
  reversed; Q8 partial — 10007 missing from their enum (flagged gap). Their allowed_mentions
  patch (TR-3.5 class) in flight; boot may run on the tip and re-probe after. Webhook execute
  path heavily patched; parent-channel coverage checked at boot.
- **2026-09-30 ~02:55** Machloket shipped the TR-1.5 client half (`6d4f9d6`): DM interactions
  send no `guild_id`; full gate green. Their queue: slash option pickers (TR-2.3) → context
  menus (TR-2.3). TzurotProbe (`/row9`) available as the boot's component exerciser.
- **2026-09-30 ~03:15** Instance B up (fork): `:3002` Deck-local, own postgres `:5434`,
  production untouched; TzurotBot + TzurotProbeB credentials minted (200 on `/gateway/bot`),
  secrets in the fork repo (`docs/local/boot-b/secrets.env`, 600, git-excluded). HTTPS origin
  `:8444` asked of Deck management; fallback self-signed proxy + `NODE_EXTRA_CA_CERTS`. Login
  divergence recorded (email-only user login — TR-8.1). Q8/10007 accepted as fork gap G3.
- **2026-09-30 ~03:30** Correction (fork, self-caught): the "10007 missing from the enum" claim
  was a mistyped grep path — `UNKNOWN_MEMBER` exists (`Constants.ts:547`). The real gap is the
  missing single thread-member GET route (generic catch-all 404, not a Discord-shaped 10007);
  fix G3 queued behind allowed_mentions, with a runtime red probe on instance B for
  before/after. Q8 and TR-3.6/7.2 rows updated.
- **2026-09-30 ~03:50** Origin LIVE (`https://deck.tail00338f.ts.net:8444`, consumer-verified
  from both sides; real tailnet cert via `/etc/hosts` → Caddy twin, no `NODE_EXTRA_CA_CERTS`).
  Boot attempt 1 hit a **Tzurot-side** blocker: api-gateway is un-bootable on a non-root host —
  avatar storage is hard-coded to the Railway volume path `/data/avatars`
  (`startup.ts:15` + `avatarPaths.ts:32`; startup `mkdir` fails EACCES). Fix dispatched
  (config-gated `AVATAR_STORAGE_PATH`, default unchanged → prod byte-identical). Prior-coverage
  check: tracker task + doc searches for "avatar storage" both empty. Boot resumes on transfer.
- **2026-09-30 ~04:10** Machloket self-correction: their `a1d443e` wired NUMBER to option type
  6 (USER) instead of 10 — fixed in `25a9aaf` (verified against the fork's `Application.ts`).
  Entity pickers (USER/CHANNEL/ROLE/MENTIONABLE/ATTACHMENT = 6/7/8/9/11) remain placeholders
  until their tranche 2 (in flight: pickers over the @/# candidate generators, snowflake values
  per the server contract, rendering against `resolved`). TR-8.1: client login field is
  email-labeled, compliant. No Tzurot exposure — nothing has booted against instance B yet.

## Appendix A — discord.js surface inventory (v1, manual pass, 2026-09-30)

> Derived 2026-09-30 by an inventory agent over develop; to be superseded by TASK-1145's
> command (TR-9.1). Dated revision: re-derive on every UX-wave merge until then.

# Tzurot Discord-API Surface Inventory (conformance checklist for a Spacebar-fork reimplementation)

Branch `develop`, working tree at `/home/deck/Projects/tzurot`. All paths relative to repo root; line numbers from the current working tree. Scope swept: `services/bot-client/src` (970 .ts files), `services/ai-worker/src`, `packages/common-types/src`, plus `services/voice-engine` (Python) for the voice question. Test files excluded except where a mock is itself load-bearing.

Key structural fact up front: **bot-client is the only process that talks Discord directly.** ai-worker has zero discord.js imports (it consumes DB-persisted message envelopes + attachment URLs); common-types has only type-level/pure-helper discord.js imports. Voice is attachment+HTTP only — there is no Discord voice-gateway code anywhere.

---

## 1. Gateway events subscribed (10 entries; ~13 distinct events)

- `services/bot-client/src/index.ts:104` — `client.on(Events.MessageCreate)`: reads `message.author` + `message.author.bot` (DM-cache warm), hands whole `Message` to `services/MessageHandler.handleMessage`. Processor-chain field consumption (tallied across `handlers/`, `processors/`): `message.id` (75), `message.author.id/.bot/.username/.displayName/.globalName/.tag`, `message.channel` (61) + `message.channel.id/.type/.messages`, `message.embeds` (38), `message.content` (38), `message.messageSnapshots` (26, forwards), `message.client` (24), `message.reference` (22), `message.guildId` (18), `message.components` (17), `message.guild` (14), `message.attachments` (10), `message.createdAt` (9), `message.member` (8), `message.webhookId` (6), `message.type` (6), `message.mentions` (6), `message.flags` (3), `message.stickers`, `message.poll`, `message.applicationId`, `message.partial`.
- `services/bot-client/src/index.ts:119` — `client.on(Events.InteractionCreate)`: reads `interaction.user`, `interaction.user.id`, `interaction.guildId`, `interaction.channelId`, `interaction.channel` (via `getThreadParentId` for denylist), `interaction.commandName`; type-narrows with `isChatInputCommand/isMessageContextMenuCommand/isModalSubmit/isAutocomplete/isStringSelectMenu/isButton`.
- `services/bot-client/src/index.ts:179` — `client.once(Events.ClientReady)`: reads `client.user?.tag`; wires all schedulers, presence restore, DM prewarmer; registers GuildCreate below.
- `services/bot-client/src/index.ts:236` — `client.on(Events.GuildCreate)`: reads `guild.id`, `guild.name`; calls `guild.leave()` (also `index.ts:471` on denylist invalidation).
- `services/bot-client/src/index.ts:251` — `client.on(Events.Error)`: client-level error logging.
- `services/bot-client/src/services/GuildMemberInfoReporter.ts:136` — `client.on(Events.GuildMemberUpdate)`: reads `before.partial`, `after.user.bot`, `after.guild.id`, `after.id`, and `extractGuildInfoFromMember` (`displayColor`, `joinedAt`, `roles` — see `services/channelFetcher/ParticipantContextCollector.ts:44` reading `member.roles.cache`). Requires GuildMembers intent.
- `services/bot-client/src/services/GuildMemberInfoReporter.ts:154` — `client.on(Events.GuildMemberRemove)`: reads `member.user.bot`, `member.guild.id`, `member.id`.
- `services/bot-client/src/services/GatewayWatchdog.ts:468` — `rawEmitter.on(Events.Raw)` (all raw gateway dispatches, timestamp-only freshness). Same file consumes `client.ws.status`/`Status.Ready` (:197, :368), `client.guilds.cache.size/.first()` (:308, :319, :400), and fires `guild.members.fetch({ query: '', limit: 1, time: … })` as a GUILD_MEMBERS_CHUNK liveness probe (:329-334) — a query-based member fetch a reimplementation must honor.
- `services/bot-client/src/services/ShardLifecycleLogger.ts:28-49` — `Events.ShardDisconnect` (closeEvent, shardId), `ShardReconnecting`, `ShardResume` (replayedEvents), `ShardReady` (unavailableGuilds), `ShardError`, `Events.Invalidated`.
- `services/bot-client/src/services/dmWorkerReadyGate.ts:40` — `client.once(Events.ClientReady)` + `client.isReady()`: gates BullMQ DM workers on gateway readiness.

## 2. discord.js client methods called for REST work (22 entries)

- `services/bot-client/src/index.ts:560` — `client.login(DISCORD_TOKEN)`; `:345` `client.destroy()`; `:468` `client.guilds.cache.get(id)`.
- Message send via channel (14 sites / 12 files): `handlers/MessageHandler.ts:586` (error content), `services/character/characterTurn.ts:263,593,704` (relay-echo chunked sends), `services/JobTracker.ts:226` (taking-longer notice), `services/VoiceTranscriptionService.ts:107`, `services/DiscordResponseSender.ts:302` (`dmChannel.send`), `services/releaseDm/setupReleaseDmWorker.ts:110` (`user.send`), `services/retentionNotice/setupRetentionNotifyWorker.ts:101` (`user.send`), `utils/ownerChannel.ts:41` (owner-channel embed + files), `utils/nsfwVerification.ts:320`.
- `services/bot-client/src/utils/WebhookManager.ts:214` — `webhook.send({ content, username, avatarURL, threadId, allowedMentions:{parse:[]}, files })` — the primary personality-response path; `:132` `channel.fetchWebhooks()`; `:141` `channel.createWebhook({ name, reason })` (owner-matched by `wh.owner?.id`); `:98/:205` thread→parent resolution + `threadId`.
- `message.reply` — 66 call sites in 36 files (DM help/verification replies, processor acks); e.g. `processors/DMSessionProcessor.ts:85,137,309`, `utils/nsfwVerification.ts:209,288`, `utils/maintenanceResponses.ts:56`.
- `services/bot-client/src/utils/confirmation/confirmDestructive.ts:351` — `interaction.message.edit(...)` (the only direct `Message.edit`).
- `message.delete` / deferred deletes — 41 sites in 25 files: `processors/DMSessionProcessor.ts:320` (self-destructing help), `utils/nsfwVerification.ts:326`, `services/VerificationMessageCleanup.ts:188-190` (fetch-then-delete tracked verification DMs).
- `channel.messages.fetch` (history/fetch-by-id, 12 sites): `services/DiscordChannelFetcher.ts:82` (context history), `processors/DMSessionProcessor.ts:265` (`{ limit: 50 }` DM backfill scan), `services/SingleJobRecovery.ts:245`, `services/MultiTagRecovery.ts:680`, `services/ReplyResolutionService.ts:264`, `services/VerificationMessageCleanup.ts:188`, `handlers/MessageReferenceExtractor.ts:215`, `handlers/references/LinkExtractor.ts:122`, `utils/HistoryLinkResolver.ts:339`, `utils/forwardedMessageUtils.ts:495`.
- `client.channels.fetch` (9 sites): `utils/fetchTypingChannel.ts:22`, `utils/ownerChannel.ts:36`, `services/VerificationMessageCleanup.ts:177`, `commands/channel/browse.ts:323`, `handlers/references/LinkExtractor.ts:59,182`, `utils/HistoryLinkResolver.ts:315`, `utils/forwardedMessageUtils.ts:492`.
- `client.users.fetch` — `services/StartupDMPrewarmer.ts:115`.
- `user.createDM()` — `services/DMCacheWarmer.ts:62` (+2 sites) — DM-channel cache warming.
- `guild.leave()` — `index.ts:239,471`.
- `guild.members.fetch(invokerId)` — `handlers/references/LinkExtractor.ts:303` (cache-first single-ID overload); `guild.members.fetch({query,limit,time})` probe — `GatewayWatchdog.ts:329`.
- `channel.members.fetch(viewerId)` (ThreadMemberManager) — `utils/threadAccess.ts` (`satisfiesPrivateThreadMembership`, relies on throw-for-non-member semantics).
- `client.guilds.cache` browsing — `commands/admin/servers.ts:311,351,380`; `guild.iconURL({size:64})` `:99`; `guild.memberCount` `:196`.
- Typing: `services/VoiceTranscriptionService.ts:363-374`, `services/JobTracker.ts:266,278` → `utils/typingErrorClassifier.ts:145-152` `sendTypingIndicator` (fire-and-forget wrapper; ESLint rule bans raw `await channel.sendTyping()`).
- Presence: `commands/admin/presence.ts:85,91` `client.user.setPresence/setActivity`, `:123` clear; restored at boot (`index.ts:221`).
- Reactions: `utils/maintenanceResponses.ts:72` `message.react('🔧')` (maintenance ack); `services/channelFetcher/ReactionProcessor.ts:41,57,96,122` reads `msg.reactions.cache` + `reaction.emoji.name` from fetched history.
- Allowed-mentions object passed per-send (`{ parse: [], repliedUser: false }`): `services/VoiceTranscriptionService.ts:183,441`, `processors/PersonalityTriggerProcessor.ts:262`, `DiscordResponseSender`/WebhookManager paths.
- Read-only member/role cache consumption: `services/contextBuilder/GuildMemberResolver.ts:37`, `services/MentionResolver.ts:104` (`guild.roles.cache.get`), `ParticipantContextCollector.ts:44`.
- Zero hits: `bulkDelete`, `channels.create`, `setTopic/setName`, role/ban/kick mutations, `awaitMessages`/`createMessageComponentCollector`/`awaitReactions` (no collectors at all).
- `client.commands` augmentation for `/help` — `index.ts:528`, typed in `types.ts`.

## 3. Interactions (12 entries)

- Type guards/routing: `services/bot-client/src/index.ts:145-171` (chat input, message context menu, modal submit, autocomplete, select menu, button); `utils/maintenanceResponses.ts:54-63` (`isAutocomplete` → `interaction.respond([])`, `isRepliable`); `utils/confirmation/confirmDestructive.ts:393` (`isFromMessage`).
- Ack patterns (call-site counts, non-test): `editReply` 567 calls / 148 files; `followUp` 63 / 30; `reply` 66 / 36; `deferReply` 20 / 17; `update` 25 / 12; `showModal` 10 / 9; `deferUpdate` 3 / 2 — all deferred component acks funnel through the wrapper `ux/render/reply.ts:85-89` (`DeferKind = 'update' | 'reply'`, an ESLint `no-restricted-syntax` rule bans raw `interaction.deferUpdate()`); autocomplete `respond` used at 94 mentions (empty-array maintenance response at `maintenanceResponses.ts:56`); `deleteReply` wrapper `services/character/chimeInTag.ts:106,281`.
- Central ack/delivery adapters: `handlers/commandDispatch.ts:122-160` (unknown-command ephemeral reply, deferralMode `ephemeral|public|none`, `createDeferredContext`), `handlers/CommandHandler.ts:212-224,309,328,390`, `ux/render/reply.ts:103,170,173,205` (ack-state-adaptive `replySpec`).
- `MessageFlags.Ephemeral` — 255 uses across bot-client (canonical: `ux/render/reply.ts:103,170,173`; `commandDispatch.ts:122,143`). Other flags: `MessageFlags.IsComponentsV2` 10 uses (`commands/character/view.ts`, `viewV2.ts`, `viewEdit.ts`), `MessageFlags.IsVoiceMessage` (`utils/voiceAttachment.ts:99`).
- customId convention `{command}::{action}::{params}` — `services/bot-client/src/utils/customIds.ts` (hand-written builders: `character::seed`, `character::modal::{characterId}::{sectionId}`, etc.) and the factory `utils/customIdFamily.ts:32` (`CUSTOM_ID_DELIMITER = '::'`, segment encoders enforce the 100-char ceiling via `DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH`). 133 `interaction.customId` reads.
- Component dispatch: `utils/componentRouter.ts:73-99` (declarative route table on customId predicates), plus `utils/subcommandRouter.ts`, `utils/subcommandContextRouter.ts`, `utils/mixedModeSubcommandRouter.ts`.
- Modals: `ModalBuilder` in 12 files (`commands/memory/detailModals.ts`, `commands/preset/create.ts`, `commands/character/create.ts`, `commands/persona/create.ts`, `commands/persona/override/set.ts`, `commands/shapes/auth.ts`, `utils/dashboard/ModalFactory.ts`, `utils/dashboard/settings/SettingsModalFactory.ts`, `utils/dashboard/showModalWithTimeoutCatch.ts`, `utils/modal/toolkit.ts`, `utils/modal/retry.ts`); `TextInputStyle.Paragraph/Short`; `interaction.fields` (23 reads).
- Autocomplete: `handlers/CommandHandler.ts` `handleAutocomplete`; `interaction.respond` with ≤ `DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES` (25) choices; 2500 ms internal budget vs Discord's 3 s ack (`packages/common-types/src/constants/discord.ts` `GATEWAY_TIMEOUTS.AUTOCOMPLETE`).
- Context menus: `ApplicationCommandType.Message` (4 uses), `ContextMenuCommandBuilder` (`handlers/CommandHandler.ts:17,125-127`), `interaction.targetId` (6 reads) — commands `commands/inspectMessage.ts`, `commands/viewReasoning.ts`.
- Select menus: `StringSelectMenuInteraction`/`StringSelectMenuBuilder`, `interaction.values` (18 reads).
- Option access: `interaction.options` (65 reads) via typed wrapper `packages/common-types/src/utils/typedOptions.ts:24-80` (string/integer/number/boolean/user/channel/role/mentionable/attachment); `packages/common-types/src/utils/ownerMiddleware.ts:8` (owner-gated interactions).
- Ack-budget discipline baked in: 3-second ack window comments + maintenance gate TTL check at `index.ts:140` ("the maintenance reply itself is the ack").

## 4. Voice (5 entries — no voice-gateway usage at all)

- Zero hits repo-wide for `@discordjs/voice`, `joinVoiceChannel`, `createAudioPlayer`, `createAudioResource`, `VoiceReceiver`, PCM/opus streams, speaking indicators, and no `voiceStateUpdate`/`Events.VoiceStateUpdate` handlers. Nobody owns a Discord voice connection; `Voice` in package.json is only `discord.js ^14.27.0` (`services/bot-client/package.json:30`).
- Voice input = voice-message attachments: `services/bot-client/src/processors/VoiceMessageProcessor.ts` (reads `message.attachments`, `message.flags`, `message.mentions`, `message.reference`), predicate `utils/voiceAttachment.ts:52-100` (`audio/*` + `duration`, plus Discord's `IsVoiceMessage` message flag for Vencord/Vesktop `video/webm` uploads), metadata extraction `utils/attachmentExtractor.ts:57-59` (`contentType`, `duration`, `waveform`).
- Transcription path: `services/bot-client/src/services/VoiceTranscriptionService.ts:383` → internal `transcribe()` gateway call (`utils/gatewayServiceCalls.js`) → api-gateway `POST /api/internal/ai/transcribe` (`services/api-gateway/src/routes/ai/transcribe.ts:3`) → voice-engine STT or ElevenLabs BYOK. Attachment `url` consumed at `VoiceTranscriptionService.ts:245-246`. Typing indicator shown during transcription (`:352-374`).
- voice-engine (`services/voice-engine/server.py`) is a plain FastAPI HTTP service, no Discord SDK: `GET /health` (:426), `POST /v1/transcribe` (:631), `POST /v1/audio/transcriptions` (:710), `POST /v1/tts` (:730), `POST /v1/audio/speech` (:877), `GET /v1/voices` (:896), `POST /v1/voices/register` (:902); auth via `x-api-key`/`Authorization` header (:402-415).
- TTS output = files attached to personality webhook sends: `WebhookManager.sendAsPersonality(..., files)` `utils/WebhookManager.ts:163-214`; `/voice` slash commands (`commands/voice/{stt,tts,voices}`) are settings/management only.

## 5. Permissions (8 entries — only 2 distinct flags referenced)

- `PermissionFlagsBits.ManageMessages` — all 6 uses: `services/bot-client/src/utils/permissions.ts:69,109,155` (`member.permissions.has(...)` in the three `requireManageMessages*` variants), `services/bot-client/src/commands/channel/settings.ts:108,178` (`interaction.memberPermissions?.has(...)`, noted null-in-DM), `services/bot-client/src/commands/history/purge.ts:84` (same channel-scoped read).
- `PermissionsBitField.Flags.ViewChannel` + `PermissionsBitField.Flags.ReadMessageHistory` — `services/bot-client/src/handlers/references/LinkExtractor.ts:314-317` (`permissions.has([ViewChannel, ReadMessageHistory])` for cross-channel link access).
- `channel.permissionsFor(member)` — `handlers/references/LinkExtractor.ts:313` (null = fail closed) and referenced in `utils/forwardedMessageUtils.ts:401`.
- `interaction.member` cast to `GuildMember` — `utils/permissions.ts:66,106`; `interaction.member as GuildMember | null` + `interaction.guild` captured into command context — `utils/commandContext/factories.ts:47-48`.
- Private-thread membership gate (permission-adjacent): `utils/threadAccess.ts` — `channel.members.fetch(viewerId)`; documented reliance on discord.js throwing `DiscordAPIError[10007]` HTTP 404 for non-members.
- Bot-owner override bypassing permission checks: `isBotOwner(interaction.user.id)` — `utils/permissions.ts:61,101,140` (backed by `packages/common-types/src/utils/ownerMiddleware.ts`, `BOT_OWNER_ID` config).
- Guild-NSFW gate is not a permission check but consumes guild state: `channel.guild.nsfwLevel === GuildNSFWLevel.AgeRestricted` — `utils/nsfwVerification.ts:104-110`.
- Zero hits for every other `PermissionFlagsBits`/`PermissionsBitField.Flags` member (no Administrator, ManageGuild, etc.), no role-hierarchy checks, no overwrite editing.

## 6. CDN / attachments (20 entries)

Bot-client:
- `services/bot-client/src/utils/discordCdnGuard.ts:15` — `DISCORD_CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net']`; `:36-61` `validateDiscordCdnUrl` (https-only + instance-CDN match + host allowlist). Callers: `commands/character/import.ts:224,253`, `commands/character/voice.ts:88` (then `fetch(attachment.url)` `:119`), `commands/character/avatar.ts:86` (fetch `:117`), `utils/jsonFileUtils.ts:80`.
- `services/bot-client/src/utils/embedImageExtractor.ts:47,55,66` — prefers `embed.image?.proxyURL ?? .url` / `embed.thumbnail?.proxyURL ?? .url` because Discord rehosts on `media.discordapp.net`.
- `services/bot-client/src/utils/WebhookManager.ts:180,195` — `avatarURL` (instance-hosted avatar path with cache-busting filename) sent on webhook messages.
- `services/bot-client/src/utils/attachmentExtractor.ts:44-60` — `attachment.id/.url/.contentType/.name/.size/.duration/.waveform/.spoiler` → `AttachmentMetadata` (`originalUrl` kept as cache-stable CDN URL); `utils/stickerAttachments.ts:71-119` — `sticker.url` + `StickerFormatType.PNG/APNG/GIF` → synthetic attachments.
- Instance-origin consumers in bot-client: `index.ts:97` (client options), `utils/deployCommands.ts:235` (REST), `utils/HistoryLinkResolver.ts:108,414`, `handlers/references/strategies/LinkReferenceStrategy.ts:35`, `commands/inspect/lookup.ts:82,96` (instance-origin message-link regex), `commands/character/api.ts` avatar flows.

common-types (the PR #2554 machinery):
- `packages/common-types/src/utils/discordInstanceOrigin.ts:21-44` — `normalizeDiscordInstanceOrigin` (https, no credentials/path/query/fragment); `:66-73` `discordRestOptions` → `{ api: ${origin}/api, cdn: origin, mediaProxy: origin }` (mediaProxy set because `@discordjs/rest` 2.6.3 builds GIF-sticker URLs from it); `:85-97` `matchesInstanceOrigin`; `:116-137` `DISCORD_INSTANCE_CDN_PATH_PREFIXES` (20 prefixes: `/attachments/`, `/avatars/`, `/avatar-decorations/`, `/avatar-decoration-presets/`, `/banners/`, `/channel-icons/`, `/discovery-splashes/`, `/embed/`, `/emojis/`, `/guild-events/`, `/guild-tag-badges/`, `/guilds/`, `/icons/`, `/role-icons/`, `/soundboard-sounds/`, `/splashes/`, `/stickers/`, `/team-icons/`, `/app-assets/`, `/app-icons/`; `/attachments/` confirmed against spacebar-server `src/cdn/routes/attachments.ts`); `:152-157` `matchesInstanceCdnUrl` (origin match AND path-prefix, never `/api`); `:165-179` `DISCORD_HOST_PATTERN` (`https://(ptb.|canary.)?discord(app)?.com`), `MESSAGE_LINK_PATH_PATTERN` (`/channels/(@me|\d+)/(\d+)/(\d+)`), `instanceMessageLinkPattern`.
- `packages/common-types/src/config/config.ts:60-70,431` — `DISCORD_INSTANCE_ORIGIN` env schema + normalization.
- `packages/common-types/src/utils/messageLinkParser.ts:34-66` — message-link regex over Discord hosts + instance origin.

ai-worker:
- `services/ai-worker/src/utils/attachmentFetch.ts:25` — `ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net']`; `:144-208` `validateAttachmentUrl` (https, instance-CDN short-circuit `:163`, no non-standard ports/credentials/IP literals, `must be from Discord CDN` error substring is load-bearing — matched by `DownloadAttachmentsStep.routeAttachmentUrl` and `utils/imageToDataUrl.ts:75`); `:32` `MAX_ATTACHMENT_BYTES` 25 MiB (matches Discord upload cap); `:73` assumes ≤10 attachments/message; `:92` `MAX_AGGREGATE_PAYLOAD_BYTES` 100 MiB; `:248-302` `fetchAttachmentBytes` (redirect:'error', 403 = expired-CDN signal).
- `services/ai-worker/src/utils/discordCdnExpiry.ts:60-77` `isDiscordCdnUrl`; `:89-121` `readDiscordCdnExpiry` (signed-URL `ex` hex param, s-vs-ms epoch range classification — assumes Spacebar signs CDN URLs with the same `ex/is/hm` scheme, see `:50-54`); `:149-158` `assertDiscordCdnUrlNotExpired`.
- `services/ai-worker/src/utils/safeExternalFetch.ts` — fallback fetch for embed images NOT on the Discord/instance CDN (Reddit/Imgur/Tenor; DNS-rebinding checks).
- `services/ai-worker/src/services/context/contentRewriter.ts:84` — parses instance-origin message links in raw content; `services/ai-worker/src/jobs/handlers/pipeline/steps/DownloadAttachmentsStep.ts` — attachment routing consumer of the above.

## 7. ID / snowflake assumptions (9 entries)

- Zero hits for `SnowflakeUtil` and `BigInt(` — no timestamp extraction from snowflakes via library/bitmath; instead:
- `packages/common-types/src/constants/discord.ts:237-249` — `DISCORD_SNOWFLAKE = { SOURCE: \d{17,20}, PATTERN: /^\d{17,20}$/ }`; `:268` `isValidDiscordId`; `:276` `filterValidDiscordIds`. All ID validation is the 17-20-digit shape — a reimplementation must emit snowflake-shaped IDs.
- `services/bot-client/src/commands/inspect/lookup.ts:41,108` — raw 17-20-digit string classified as a message-ID lookup (`SNOWFLAKE_REGEX = DISCORD_SNOWFLAKE.PATTERN`).
- Mention format assumption: `services/ai-worker/src/services/reference/UserReferencePatterns.ts:95` — `DISCORD_MENTION: /<@!?(\d{17,20})>/g` (pillow-ping `<@id>` / `<@!id>` tokens in content).
- Snowflake-time ordering: `services/bot-client/src/services/character/characterTurn.ts:267-270,601-602` — echo `createdAt` derived from snowflake time; DB rows sorted against bot-observed snapshots by snowflake-derived timestamps (~80ms anchoring). `utils/forwardedMessageUtils.ts:506` — createdTimestamp derived from the id.
- Config IDs validated as snowflakes: `packages/common-types/src/config/config.ts:51-88` — `DISCORD_CLIENT_ID`, `GUILD_ID`, `BOT_OWNER_ID`, `FEEDBACK_CHANNEL_ID` all `optionalDiscordId()`; used at `index.ts:237` (guild denylist), `deployCommands.ts:177` (clientId into `Routes.applicationCommands`).
- customId payloads carry snowflakes: `commands/history/purge.ts:154` (channelId as ≤20-char snowflake segment), `commands/deny/detailEdit.ts:34` (snowflake-or-UUID), `utils/customIdFamily.ts` segment encoders.
- Message-ID-keyed lookups: `processors/DMSessionProcessor.ts:279` (`lookupPersonalityFromMessage(msg.id)`), `services/MultiTagRecovery.ts`/`SingleJobRecovery.ts` (jobId ↔ messageId recovery), `ai-worker` `discordMessageId` arrays (`services/context/relayEchoRecovery.ts:56-64`).
- Sentinel exceptions: `commands/character/api.ts:242` — reserved orphan-sentinel discordId deliberately NOT a snowflake; `services/HttpPersonalityLoader.ts:74` — personality names may contain snowflake-safe charset.

## 8. Gateway/client config (7 entries)

- `services/bot-client/src/utils/discordClientOptions.ts:28-46` — `ClientOptions`: intents `[Guilds, GuildMessages, MessageContent, GuildWebhooks, DirectMessages, GuildMembers]` (GuildMembers privileged; required so `message.member` is non-null), `partials: [Partials.Channel, Partials.Message, Partials.User]` (documented as required for DM MESSAGE_CREATE to fire after restart), `allowedMentions: { parse: [] }` (global ping suppression), plus additive `rest` overrides when `DISCORD_INSTANCE_ORIGIN` set.
- No sweepers configuration anywhere (zero hits) — discord.js defaults. No `ShardingManager`/`shardCount` (zero hits) — single default-sharded `Client`.
- Login: `services/bot-client/src/index.ts:556-561` (`client.login(config.discordToken)`); token validation `services/bot-client/src/startup.ts:16-19` (`DISCORD_TOKEN` required).
- `discord.js ^14.27.0` pinned (`services/bot-client/package.json:30`, `packages/common-types/package.json:69-70`); `discord-api-types ^0.38.55` (`packages/common-types/package.json:69`) — behavior claims in comments cite 14.27.0 internals (`utils/threadAccess.ts`, `utils/attachmentExtractor.ts:17-22`).
- `client.destroy()` in graceful shutdown — `index.ts:345`; shutdown sequencing documented around Discord session-timeout semantics (`index.ts:276-284`).
- Readiness gating: `client.isReady()` / `ClientReady` once — `services/dmWorkerReadyGate.ts:37-42`; `client.ws.status === Status.Ready` — `GatewayWatchdog.ts:368`.
- `client.commands` augmentation — `index.ts:528`, `types.ts`.

## 9. Other REST / webhooks (6 entries)

- Application-command registration: `services/bot-client/src/utils/deployCommands.ts:143` `rest.put(Routes.applicationGuildCommands(clientId, guildId))` (dev, when `GUILD_ID` set) and `:153` `rest.put(Routes.applicationCommands(clientId))` (global/production); `:235` dedicated `new REST(discordRestOptions(origin) ?? {}).setToken(token)`; hash short-circuit store `utils/commandRegistrationGate.ts`; auto-register on boot only on Railway (`index.ts:494-506`, `shouldAutoRegisterCommands`); manual script `services/bot-client/scripts/deploy-commands.ts` + `package.json:22-23` (`deploy-commands`, `deploy-commands:railway`).
- Webhook create/execute: `utils/WebhookManager.ts:132` `fetchWebhooks()`, `:141` `createWebhook({ name: \`${client.user.username} Personalities\`, reason })`, `:214` `webhook.send({ username, avatarURL, threadId, allowedMentions: { parse: [] }, files })`, cache of 100 (`DISCORD_LIMITS.WEBHOOK_CACHE_SIZE`). This is the only webhook usage in bot-client proper.
- Raw webhook POST by URL (owner alerting): `services/bot-client/src/services/GatewayWatchdog.ts:239-244` — bare `fetch(WATCHDOG_ALERT_WEBHOOK_URL, { method: 'POST', body: { content } })`, i.e. a Discord webhook-execute URL consumed outside discord.js.
- Invites: zero hits (no `invites.create`/`invite` handling). Emoji/sticker upload: zero hits (stickers/emoji only read — `utils/stickerAttachments.ts`, `channelFetcher/ReactionProcessor.ts:122`). Audit log: zero hits.
- Message-context-menu command registration rides the same PUT body (`ApplicationCommandType.Message` command JSON from `ContextMenuCommandBuilder.toJSON()`).
- No direct Discord REST usage in ai-worker or api-gateway (api-gateway's `/api/internal/ai/transcribe` calls voice-engine, not Discord).

## 10. Anything else Discord-shaped (17 entries)

- Discord numeric error codes relied upon: `services/bot-client/src/services/VerificationMessageCleanup.ts:167-173` — `EXPECTED_ERROR_CODES = {10008 Unknown Message, 10003 Unknown Channel, 50001 Missing Access, 50013 Missing Permissions}`; discord.js error-code shape `(error as {code?:number}).code` also at `:196`. Owner-gate 403 semantics at `StartupDMPrewarmer.ts:127` ("10013").
- Rate-limit handling: `utils/typingErrorClassifier.ts:40-44,69` (429 + `error.retryAfter` extraction), `utils/apiCheck.ts:33-45` (429 classified transient), `utils/dmErrorClassifier.ts:53`, `services/JobTracker.ts:338` (delete 404/429 tolerance), `services/StartupDMPrewarmer.ts:41` (1 req/sec pacing "well under Discord's global rate limit" for createDM bursts).
- Discord constants table: `packages/common-types/src/constants/discord.ts:60-110` `DISCORD_LIMITS` — `MESSAGE_LENGTH: 2000`, `EMBED_DESCRIPTION: 4096`, `EMBED_FIELD: 1024`, `EMBED_TITLE: 256`, `EMBED_FIELD_NAME: 256`, `EMBED_FOOTER: 2048`, `AVATAR_SIZE: 10 MiB`, `WEBHOOK_CACHE_SIZE: 100`, `AUTOCOMPLETE_MAX_CHOICES: 25`, `AUTOCOMPLETE_CHOICE_MAX_LENGTH: 100`, `CUSTOM_ID_MAX_LENGTH: 100`, `MODAL_INPUT_MAX_LENGTH: 4000`, `CHAT_MESSAGE_INPUT_MAX_LENGTH: 4000`, `SHORT_PARAGRAPH_MAX_LENGTH: 1000`, `SLUG_MAX_LENGTH: 50`, `MODAL_TITLE_MAX_LENGTH: 45`, `FILE_UPLOAD_MAX_BYTES: 8 MiB`; plus `GATEWAY_TIMEOUTS` (`AUTOCOMPLETE: 2500` against Discord's 3-second ack, `DEFERRED: 10000` inside Discord's 15-min post-defer window).
- Chunking against the 2000-char limit: `packages/common-types/src/utils/discord.ts:14,253,371` (`splitMessage`/`splitMessageByLines`, fence-aware), `utils/chunkedReply.ts` (ephemeral chunked delivery), `services/character/characterTurn.ts:263` (echo chunking), `utils/embedLimits.ts` (1024-char field cap handling).
- Message types consumed: `MessageType.{Default, Reply, ChatInputCommand, ContextMenuCommand, ThreadCreated, ThreadStarterMessage, ChannelPinnedMessage, ChannelFollowAdd, GuildBoost, GuildBoostTier1-3, UserJoin, AutoModerationAction}` (13 members; `utils/messageTypeUtils.ts`, `processors/EmptyMessageFilter.ts`).
- Forwarded messages: `MessageReferenceType.Forward` (75 uses) + `message.messageSnapshots` (26 reads) — `handlers/references/ReferenceFormatter.ts`, `handlers/references/SnapshotFormatter.ts:118-129`, `utils/forwardedMessageUtils.ts`, `utils/MessageContentBuilder.ts`, `processors/EmptyMessageFilter.ts:51-54`.
- Channel-type model: `ChannelType.{DM, GroupDM, GuildText, GuildNews, GuildAnnouncement, AnnouncementThread, PublicThread, PrivateThread, GuildForum, GuildMedia, GuildCategory, GuildDirectory, GuildStageVoice, GuildVoice}` (14 members) — `utils/discordChannelTypes.ts:18-32`, `utils/nsfwVerification.ts:113-135`, `utils/WebhookManager.ts:105-108` (webhook parent must be GuildText/GuildAnnouncement/GuildForum), `packages/common-types/src/types/discord-types.ts:11-35` (`TypingChannel` type guard using `discord-api-types/v10` ChannelType).
- NSFW verification + DM flows: `utils/nsfwVerification.ts:101-138` (`guild.nsfwLevel === GuildNSFWLevel.AgeRestricted`, `channel.nsfw` on GuildText/GuildNews/parent-of-thread), `:207-223` (verification DM reply + tracking), `:240-269` (`evaluateNsfwGate`: auto-verify in NSFW channels, fail-closed elsewhere), `:315-333` (self-destructing confirmation), `services/VerificationCleanupService.ts` + `services/VerificationMessageCleanup.ts` (scheduled DM cleanup), `utils/pendingVerificationMessages.ts` (Redis tracking).
- `processors/DMSessionProcessor.ts` — DM sticky-session flow: `:47` `**DisplayName:**` webhook-prefix regex for bot-message identification, `:72-73` `message.author.id` / `message.client.user?.id`, `:81-98` NSFW gate before anything, `:194-200` channel_settings lookup by channelId, `:265` `channel.messages.fetch({limit:50})` history backfill, `:273` prefix scan + `:279` message-id→personality DB lookup, `:306-328` self-destructing help message.
- `services/StartupDMPrewarmer.ts` — startup `users.fetch` → `createDM` walk over `GET /internal/users/recent` discordIds at 1/sec (`:115-138`), allowlist filter (`:103-111`), retry/backoff on gateway availability (`:52`); DM-cache warming design assumes discord.js's DM-cache-before-event behavior.
- `services/DMCacheWarmer.ts` — memoized `user.createDM()` (`:62`); whole service exists because discord.js v14 `MessageCreateAction` silently drops DM MESSAGE_CREATE without a cached channel (`:4-15`) — a discord.js-internal behavior a reimplementation may not share (harmless if absent, but the bot's DM reliability depends on it today).
- Bot self-mention detection: `processors/BotMentionProcessor.ts:20` (`message.mentions.has(message.client.user)`), `processors/VoiceMessageProcessor.ts:70`, `utils/maintenanceResponses.ts:71`; bot-self filtering `message.author.bot` (BotMessageFilter.ts, WebhookManager/DiscordChannelFetcher webhook-name suffix logic `utils/webhookNaming.ts`).
- Components V2 (new Discord surface): `MessageFlags.IsComponentsV2` + `ComponentType.{Container, TextDisplay, MediaGallery, Section, Thumbnail, Label, FileUpload, Checkbox, CheckboxGroup, RadioGroup, TextInput, ActionRow, Button, StringSelect}` — `utils/embedComponents.ts:38-58`, `commands/character/viewV2.ts`, fixture `utils/fixtures/vxredditComponentsV2Embed.ts` (notes shapes undocumented/untyped in discord-api-types — a reimplementation likely lacks these).
- Webhook/DM duality of the response path: `services/DiscordResponseSender.ts:188-260` (`sendResponse`: webhook for guild channels incl. NewsChannel, `dmChannel.send` for DMs), `services/channelFetcher/DiscordChannelFetcher.ts:344-380` (bot-author classification via `webhookId` + bot-suffix; PluralKit-style webhooks treated as unaffiliated), ai-worker `relayEchoRecovery.ts` (DM relay-echo `**Name:**` reposts).
- Interaction lifecycle flags: `interaction.deferred` (18), `interaction.replied` (13), `interaction.ephemeral` (1), `interaction.createdTimestamp` — ack-state machine in `ux/render/reply.ts` and `handlers/CommandHandler.ts` (3s/15min window discipline).
- Presence model: `ActivityType.{Playing, Listening, Watching, Custom, Competing}` — `commands/admin/presence.ts:21-27`, persisted in Redis key `bot:presence`, restored at `index.ts:221`; also `TimestampStyles.RelativeTime` + `time()` formatting (1 use).

---

## Counts

| Section | Entries |
|---|---|
| 1. Gateway events subscribed | 10 |
| 2. Client methods for REST work | 22 |
| 3. Interactions | 12 |
| 4. Voice | 5 |
| 5. Permissions | 8 |
| 6. CDN / attachments | 20 |
| 7. ID / snowflake assumptions | 9 |
| 8. Gateway/client config | 7 |
| 9. Other REST / webhooks | 6 |
| 10. Other Discord-shaped | 17 |
| **Total** | **116** |

Zero-hit groups called out explicitly: no Discord voice-gateway/`@discordjs/voice` usage of any kind (section 4); no `SnowflakeUtil`/`BigInt` snowflake math (section 7); no sweepers or sharding config (section 8); no invite, emoji/sticker upload, or audit-log API usage (section 9); no `bulkDelete`, channel create, collectors (`awaitMessages`/`createMessageComponentCollector`), or permission-flag members beyond `ManageMessages`, `ViewChannel`, `ReadMessageHistory` (sections 2 and 5).
