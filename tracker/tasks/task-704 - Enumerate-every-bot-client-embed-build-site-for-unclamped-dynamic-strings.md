---
id: TASK-704
title: Enumerate every bot-client embed build site for unclamped dynamic strings
status: To Do
assignee: []
created_date: '2026-08-20 17:19'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 704000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-20 prod incident (owner-reported): /character edit died because one section preview exceeded the 1024-char embed field cap and discord.js throws at build time rather than truncating. PR #2161 fixed the dashboard builder structurally, the identity preview, and /character view direct sites - but bot-client builds embeds in many more places (admin commands, browse, servers, memory views, the Components-V2 view renderer) and any dynamic string interpolated into setTitle/addFields/setDescription/setFooter from user- or import-controlled data is the same class.

What: enumerate deterministically (grep addFields, setTitle, setDescription, setFooter across services/bot-client/src, minus test files), classify each site static-safe vs dynamic, and route every dynamic site through clampEmbedText (utils/embedLimits.ts) or a bounded truncation. Check the Components-V2 renderer (viewV2.ts) against its own component text caps too.

Acceptance: the enumeration (site list with per-site verdicts) is in the closing PR body; every dynamic site is clamped or has a stated boundedness argument; a canary shows at least one newly-clamped site would have thrown pre-fix.

Two members added from the #2161 review rounds: (1) clampEmbedText / truncatePreview / truncateField all slice by UTF-16 code unit, so a cut landing inside a surrogate pair leaves a broken glyph before the ellipsis - fix once code-point-safe with a boundary test straddling an astral character (cosmetic only, cannot re-throw); (2) the aggregate ~6000-char total-embed limit is NOT enforced by discord.js at build time (probed: 7x1024-char fields build fine), so it is an API-side rejection class distinct from the build-time throws - decide whether the sweep should budget totals or accept the API error as the backstop.
<!-- SECTION:DESCRIPTION:END -->
