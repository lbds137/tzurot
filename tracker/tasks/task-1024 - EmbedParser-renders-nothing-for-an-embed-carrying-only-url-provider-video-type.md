---
id: TASK-1024
title: EmbedParser renders nothing for a Components-V2 link embed (vxreddit)
status: To Do
assignee: []
created_date: '2026-09-19 17:46'
updated_date: '2026-09-19 18:20'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1020000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a prod message rendered `<embeds>\n<embed>\n\n</embed>\n</embeds>` into the prompt — an embed object present with zero renderable fields — and the character correctly reported the embed as empty. Prod requests 39a90679-300d-40aa-854d-b5a1e8ddba18 and 0d4f851a-2b6b-496a-9117-ae2d64c3906a, 2026-09-19, same Discord message (posted 12:05 EDT, both prompts assembled 12+ and 17+ minutes later). Owner-visible: the character cannot see art the owner shared.

Evidence gathered (verified, not assumed):
- Channel history is a LIVE Discord REST fetch, not a DB read — MessageContextBuilder: "bot-client no longer reads channel history from Postgres", via DiscordChannelFetcher `channel.messages.fetch({limit, before})`. So this is NOT the ordinary MESSAGE_CREATE embed race: two independent fetches, 12 and 17 minutes after the post, both came back with nothing.
- The source is healthy. Fetching the exact URL with a Discordbot user-agent returns HTTP 200 with valid og:title, og:image and og:site_name.
- Not systemic. Across both debug dumps, 32 embed-bearing history messages from 2026-08-23 to 2026-09-18 rendered fully; only the 09-19 one is blank. One occurrence.
- `EmbedParser.parseEmbed` (services/bot-client/src/utils/EmbedParser.ts) reads title, author, description, fields, image, thumbnail, footer, timestamp and color. It reads NONE of `embed.url` as a standalone element (only as the `<title>` attribute, so a title-less embed loses its URL entirely), `embed.provider`, `embed.video`, or `embed.type`. An embed carrying only those renders as literally nothing — which is one way to produce exactly the observed output.
- There is no MessageUpdate handler in bot-client. CORRECTION (caught by the step-2 orchestrator, whose grep found what mine missed): the "embed processing delay" HistoryLinkResolver.ts contrasts itself against is REAL and LIVE — `MessageReferenceExtractor.ts` awaits `this.delay(this.embedProcessingDelayMs)` (default `INTERVALS.EMBED_PROCESSING_DELAY`, 2500 ms, wired from `ReferenceExtractor.ts`) on the referenced-message path only. The HistoryLinkResolver bullet is accurate prose and stays. The earlier sentence here ("there is no such delay") was a negative-existence claim made on a one-vocabulary grep; it is retracted. It changes nothing about the root cause below: the delay sits on the reply-reference path, and the observed blank embed was a channel-history fetch 12+ minutes after posting.

ROOT CAUSE — established by probe, not inference. vxreddit has adopted Discord **Components V2** for its link unfurls. Fetching the offending URL with a Discordbot user-agent returns, alongside the legacy og: tags, a `<script id="discord:component-embed" type="application/json">` block whose payload is a Container tree, not an APIEmbed:

    {"component": {"accent_color": 16729344, "components": [
      {"content": "-# vxReddit", "type": 10},
      {"content": "** u/Novel_Ice9583 on r/Cult_of_Emily - [up]694 | [msg]14 [(link)](https://www.reddit.com/comments/1wiq2ui) **", "type": 10},
      {"content": "## Emily-s trying something new for an outfit", "type": 10},
      {"items": [{"media": {"url": "https://i.redd.it/0jx38j1r32qh1.jpeg"}}], "type": 12}
    ], "type": 17}}

That tree matches the owner-supplied screenshot one-for-one: the `-#` subtext renders as the small "vxReddit" provider line, the bold TextDisplay as the author line ending in a markdown "(link)", the `##` TextDisplay as the title, the MediaGallery as the image, and accent_color 16729344 = 0xFF4500, the same reddit orange every OLDER vxreddit embed carried in its legacy `<color>` element. Type numbers confirmed against the installed discord.js 14.27: Container=17, TextDisplay=10, MediaGallery=12, Section=9, Thumbnail=11, File=13, Separator=14.

This explains every observation the legacy-race hypothesis could not: the embed is bare on re-fetch 12 and 17 minutes later because nothing is racing — the content simply is not in the fields `parseEmbed` reads; and it is NEW because vxreddit changed format, not because we did. Rollout is partial, so it will get worse, not better: of two older vxreddit URLs probed the same way, one now serves a component-embed block and one does not.

STILL INFERRED, and the reason the diagnostic leads: WHERE discord.js surfaces the Container tree. The observed shape (`message.embeds.length === 1` with every legacy field absent) is consistent with Discord keeping an embed SLOT while carrying the content in `message.components`, but no payload has been captured. Do not build the renderer against a guessed location.

GROUNDING for the diagnostic (verified in the installed typings, `services/bot-client/node_modules/discord.js/typings/index.d.ts`): `Message.components` is declared `TopLevelComponent[]`, and `TopLevelComponent` is the union `ActionRow | ContainerComponent | FileComponent | MediaGalleryComponent | SectionComponent | SeparatorComponent | TextDisplayComponent`. So discord.js 14.27 already models the whole Components-V2 tree on the message, fully typed — no library upgrade is needed and the renderer will not have to hand-parse raw JSON. What this does NOT establish, and what the diagnostic exists to answer: whether Discord populates that array for an AUTO-GENERATED link unfurl, or only for components a bot itself sent. The typing tells us where to look and that it will be typed when we get there; it says nothing about whether the unfurl lands there. `ComponentType` values confirmed at runtime from the same install: Container=17, TextDisplay=10, MediaGallery=12, Section=9, Thumbnail=11, File=13, Separator=14 — matching vxreddit's payload exactly.

Fix shape, in this order:
1. Diagnostic first. When `parseEmbed` produces an empty string, log the shape — `Object.keys(embed)`, `embed.type`, and the component-type tree found on the message (`message.components.map(c => c.type)` and one level of children). Type numbers and key NAMES only, never content values (00-critical logging rule). One prod occurrence then tells us exactly where the tree lives. Commit as `debug:` and retire it with `Retires-debug:` when the renderer lands.
2. Render the Container tree once its location is known: TextDisplay content, MediaGallery item urls, Section/Thumbnail, accent_color. The MediaGallery urls matter twice over — they are also what the vision pipeline needs in order to describe the image, which is the half that makes the character actually SEE shared art.
3. Never emit a content-free `<embed></embed>`. Either omit it or render a marker naming what was present, so "embed exists" and "embed rendered something" stop being different predicates with nothing checking.
4. Independently of all the above, and correct on its own merit: `parseEmbed` drops `embed.url` (it survives only as a `<title>` attribute, so a title-less legacy embed loses its link entirely), `embed.provider`, `embed.video`, and `embed.type`. Render them.

Acceptance: the diagnostic fires on the empty path carrying no content values; once a prod capture lands, a unit test pins that a Components-V2 container renders its TextDisplay text and MediaGallery urls; a second pins that a genuinely empty embed emits no bare `<embed></embed>`; a third pins the legacy url/provider/video/type gap in (4).

GROUNDING 2026-09-20 (pre-staged while PR #2458 ran; nothing implemented). Three facts the fix shape above did not carry, each verified rather than assumed:

1. The discord.js half of the grounding HOLDS at the installed version. `node -e` on the installed package reports 14.27.0, and `grep -n 'components: TopLevelComponent' services/bot-client/node_modules/discord.js/typings/index.d.ts` finds the `Message` declaration, with `grep -n 'export type TopLevelComponent' -A3` confirming `ContainerComponent` in the union. No library upgrade is needed and the tree will be typed when reached.

2. Nothing in bot-client reads an INBOUND message.components. `git grep -rn '\.components' -- services/bot-client/src` excluding tests returns 18 non-test hits, and every one is an OUTBOUND reply payload (`components: result.components` in browse/view/purge/inspect/persona/preset/chimeInTag and the settings dashboard) rather than a read of a received message. So the Components-V2 tree on an incoming message is not merely unrendered, it is never touched. That is consistent with the observed blank embed and rules out a partial read somewhere upstream.

3. The empty-embed wrapper has FOUR sites, and they split on whether a live Message is in hand. This matters because step 1 of the fix shape wants to log `message.components` alongside the empty `parseEmbed` result, and two of the four cannot:
   - LIVE Message, can log the component tree: `EmbedParser.parseMessageEmbeds` (grep `parseMessageEmbeds` in `services/bot-client/src/utils/EmbedParser.ts`), reached from `MessageFormatter.ts` (grep `embeds: EmbedParser.parseMessageEmbeds`); and the main-message loop in `MessageContentBuilder.ts` (grep `Process main message embeds`).
   - SNAPSHOT/stored embeds, NO Message object, so only the empty-shape half is available: `SnapshotFormatter.ts` and the snapshot branch of `MessageContentBuilder.ts` (both grep `Snapshot embeds are already APIEmbed format` or the `toJSON` in `embed` ternary).
   Consequence for step 3 (never emit a content-free `<embed></embed>`): that guard belongs at all FOUR wrapper sites, not inside `parseEmbed`, because `parseEmbed` returns the body and the wrapper supplies the `<embed>` tags. Doing it in `parseEmbed` cannot suppress the wrapper.

PARTIAL 2026-09-20 — PR #2459 merged (`a82e82b4b`). Steps 1, 3 and 4 of the fix shape shipped. Step 2, the Components-V2 renderer, is the ONLY remaining work and this task stays open carrying it alone.

Acceptance, per clause:
- the diagnostic fires on the empty path carrying no content values — MET, and on a WIDER path than the clause describes. "The empty path" needed redefining: step 4 made `type` and `url` renderable, and Discord sets `type` on essentially every embed, so an empty-body predicate would have stopped firing on exactly the vxreddit shape. `embedHasRenderableContent` keys on the embeds own fields instead. The no-values half is pinned by a test that plants four adversarial values (author.icon_url, footer.icon_url, a component content string, a media url), serializes the log payload and asserts every one absent.
- once a prod capture lands, a unit test pins that a Components-V2 container renders its TextDisplay text and MediaGallery urls — NOT MET and not meetable yet, by its own wording. This is step 2 and the reason the task stays open.
- a genuinely empty embed emits no bare `<embed></embed>` — MET at all four wrapper sites, canaried per-site.
- the legacy url/provider/video/type gap — MET, with `type` scoped: it renders only when NOT `rich`, since discord-api-types documents `rich` as the generic type for an embed rendered from its own attributes, so it names the rendering mode rather than what an unfurl wrapped.

What the next session needs, which the fix shape above did not carry: the guard belongs at the four WRAPPER sites, not inside `parseEmbed`, which returns only the body — they now share one `EmbedParser.formatEmbedElement`, so step 2 has a single place to hook. `MessageFormatter.ts` is a CALLER of `parseMessageEmbeds`, not a fifth wrapper site; a guard there could not suppress a wrapper it does not emit. Only two of the four hold a live `Message`, so only those two can log a component tree.

The watch that unblocks step 2: a prod log line from EmbedShapeDiagnostics carrying a NON-EMPTY `components` array. That settles the one question this task records as inferred — whether Discord populates `message.components` for an AUTO-GENERATED unfurl. An occurrence with `componentCount: 0` is equally informative and means the tree is somewhere else; do not read it as the diagnostic failing.

Scope limit of the watch, recorded at the fresh-reader review 2026-09-20 (Fable, post-merge): the diagnostic is reached only through `formatEmbedElement`, which every wrapper site calls once per entry of `message.embeds` — so it is gated on the message carrying at least ONE legacy embed entry. That holds for the observed incident (the assembled prompt showed a blank `<embed></embed>`, which is how we know the array was non-empty). If Discord ever ships a Components-V2 unfurl with `embeds: []` and the tree only in `message.components`, NOTHING logs, and neither the non-empty nor the zero `componentCount` reading applies. A quiet watch after this reaches prod is therefore not proof the shape stopped occurring; the tell would be a fresh owner report of blank art with no diagnostic line for its message id, and the fix is a second probe at `parseMessageEmbeds` keyed on `message.components.length > 0` when `message.embeds` is empty. Not shipped now: no evidence the empty-array shape exists, and the renderer (step 2) would read `message.components` regardless of the embeds array.

Residue filed rather than absorbed: TASK-1028 (trim the component-tree half once the capture lands; carries the `message?` typecheck coupling, the warn-level watch, and per-message batching).

CAPTURE 2026-09-21 — the watch fired, and the inferred location was WRONG. The 09-19 message (Discord id 1550900659652403344) was still inside the 50-message history window when beta.227 reached prod, so the first ordinary turn in that channel (request d05c7b8f-0676-49d6-b0b0-22c3259594ec, 00:40Z) re-rendered it under the new code. Two observations, both from prod, both structural only:
- The assembled prompt carries `<embed rendered="false" keys="components,content_scan_version,type,url">` with `<type>components</type>`.
- The EmbedShapeDiagnostics line for the same message: `embedType="components" componentCount=0 components=[]`.

Reading: the Container tree lives ON THE EMBED OBJECT under `embed.components`, with `embed.type` set to the literal string `components`; `message.components` is empty for an auto-generated unfurl. discord.js preserves the unknown key because `Embed` spreads the raw payload into `data` and `toJSON()` spreads it back out (`node_modules/.pnpm/discord.js@14.27.0/.../src/structures/Embed.js`, constructor and `toJSON`). The `embeds: []` scope limit recorded above therefore did not apply to this occurrence and has no evidence behind it.

Nothing types or documents this shape (all probed 2026-09-21, all empty): discord-api-types 0.38.55 — installed AND latest on npm — has no `components` member in `EmbedType` and no `components` field on `APIEmbed` (`payloads/v10/message.d.ts`); discord.js 14.27.0 (installed and latest) reads nothing off it inbound; the `main` branches of both repos on GitHub likewise; Discord's api-docs `resources/message.mdx`, `components/reference.mdx` and `change-log.mdx` have no `content_scan_version` and no components-typed embed. The renderer therefore narrows `embed.components` at runtime by numeric `type`; the NODE types are already installed (`APIContainerComponent`, `APITextDisplayComponent`, `APIMediaGalleryComponent`, `APIUnfurledMediaItem` with `url`/`proxy_url`/`width`/`height`, same file lines 1499-1734), so the tree is typed once narrowed.

Still unobserved and the last gate on step 2: the node shape INSIDE `embed.components` — whether the top level is `[Container]` or the page script's `{component: Container}` wrapper, and whether Discord adds `proxy_url` on the MediaGallery items (that decides whether the vision path can use the Discord CDN proxy the way `extractEmbedImages` does for legacy `image.proxyURL`, or must go through the external-image fallback for `i.redd.it`). RESOLVED 2026-09-21 by the read-only REST probe (`GET /channels/1226207363342663781/messages/1550900659652403344`, run under `railway run -s bot-client -e production` after the owner switched the session to manual mode; `pnpm ops run --with` could not supply the token because it reads the shared tier and `DISCORD_TOKEN` is service-scoped). The node shape: `embed.components` is `[Container{type:17, accent_color:16729344, components:[TextDisplay{type:10,content:"-# vxReddit"}, TextDisplay{"** u/… on r/… - ⬆️ 691 | 💬 14 [(link)](…) **"}, TextDisplay{"## <title>"}, MediaGallery{type:12, items:[{media:{url:"https://i.redd.it/….jpeg", proxy_url:"https://images-ext-1.discordapp.net/external/…/https/i.redd.it/….jpeg", width:1080, height:785, content_type:"image/jpeg", placeholder, loading_state, flags}, description:null, spoiler:false}]}], spoiler:false}]` — the top level is the Container itself (no `{component: …}` wrapper), and Discord DOES add `proxy_url` on the media. `images-ext-1.discordapp.net` is not on ai-worker's `ALLOWED_HOSTS` (`attachmentFetch.ts`), but `imageToDataUrl.ts` routes any rejected host through `safeExternalFetch`, so the vision path needs no allowlist change. Verbatim capture kept as the unit's test fixture. Step 2 DISPATCHED the same day as one nested unit (renderer + extractor + the TASK-1028 trim), base `cefd36162` — **PR #2461** opened 2026-09-21 (new `embedComponents.ts`, `EMBED_NAMING.MEDIA_SLOT`, `embedMediaAttachmentName`, the `messageId` diagnostic shape; nine claim/canary pairs in the PR body). Close this task when it merges. Step 2 scope confirmed from the grounding: render TextDisplay/Section text and MediaGallery media inside `formatEmbedElement` (single hook, all four wrapper sites), AND extend `embedImageExtractor.extractEmbedImages` (`services/bot-client/src/utils/embedImageExtractor.ts`) to emit MediaGallery items as `isEmbedPreview` attachments so the vision pipeline describes the art.
<!-- SECTION:DESCRIPTION:END -->
