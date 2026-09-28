---
id: TASK-1144
title: Instance CDN path allowlist can drift from Discord/Spacebar CDN routes
status: To Do
assignee: []
created_date: '2026-09-28 04:07'
updated_date: '2026-09-28 04:08'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: DISCORD_INSTANCE_CDN_PATH_PREFIXES (packages/common-types/src/utils/discordInstanceOrigin.ts, PR #2554) is hand-curated from discord-api-types v10 CDNRoutes, @discordjs/rest 2.6.3 CDN class and spacebar-server src/cdn routes. A new CDN route shape in a future SDK bump or Spacebar release is refused by the guards (fail-closed: that media type fails to fetch) with nothing failing loudly.

What: when discord-api-types or @discordjs/rest is bumped, or an instance media fetch is refused on an unlisted path, diff CDNRoutes against the list and extend it. Optional: a test that enumerates CDNRoutes builders and asserts each path starts with a listed prefix, so a bump breaks CI instead of prod.

Acceptance: the list covers every CDNRoutes shape of the installed discord-api-types; /api stays excluded.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Spacebar fork session (2026-09-28) listed the instance's src/cdn/routes prefixes. Served there but NOT in DISCORD_INSTANCE_CDN_PATH_PREFIXES: discover-splashes/ (misspelled alias of discovery-splashes) and badge-icons/ — refused today (fail-closed). Add them on the next touch if the bot ever fetches either.
<!-- SECTION:NOTES:END -->
