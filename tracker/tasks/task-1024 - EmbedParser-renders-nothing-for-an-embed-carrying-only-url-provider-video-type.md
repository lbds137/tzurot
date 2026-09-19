---
id: TASK-1024
title: EmbedParser renders nothing for an embed carrying only url/provider/video/type
status: To Do
assignee: []
created_date: '2026-09-19 17:46'
labels:
  - 'area:bot-client'
  - 'size:S'
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

NOT established: why Discord returned a field-free embed while its own client renders the embed fully. Code-reading cannot answer that, and nothing logs the raw payload. Do not ship a fix on a guessed mechanism.

Fix shape, in this order:
1. Diagnostic first. When `parseEmbed` produces an empty string, log the raw embed shape — `Object.keys(embed)` plus `embed.type` and whether `url`/`provider`/`video` are present. Field NAMES and presence booleans only, never values (00-critical logging rule). This is the one observation that makes the next occurrence diagnosable. Commit type `debug:` if it is pure instrumentation to be removed later, `feat:` if it stays as permanent observability.
2. Render the fields the parser drops: a standalone `<url>` (or a url attribute on `<embed>`) so a title-less embed keeps its link, plus `<provider>`, `<video>`, and the embed `type`. This is correct on its own merit regardless of the root cause.
3. Never emit a content-free `<embed></embed>`. Either omit the embed entirely or render a marker naming what was present, so "embed exists" and "embed rendered something" stop being different predicates with nothing checking.

Acceptance: a unit test pins that an embed carrying only `{type, url, provider}` renders its url and provider rather than an empty element; a second pins that a genuinely empty embed object does not emit a bare `<embed></embed>`; the diagnostic log fires on the empty path and carries no field values.
<!-- SECTION:DESCRIPTION:END -->
