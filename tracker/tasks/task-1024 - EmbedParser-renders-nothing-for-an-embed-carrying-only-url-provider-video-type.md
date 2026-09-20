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
- There is no MessageUpdate handler in bot-client and no embed-wait anywhere. The claim in HistoryLinkResolver.ts that MessageReferenceExtractor has an "embed processing delay" is stale prose — grep for it, there is no such delay.

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
<!-- SECTION:DESCRIPTION:END -->
