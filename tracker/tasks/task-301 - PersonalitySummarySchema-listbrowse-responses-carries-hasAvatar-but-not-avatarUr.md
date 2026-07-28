---
id: TASK-301
title: 'PersonalitySummarySchema: carry avatarUrl, not just hasAvatar'
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-07-28 23:10'
labels:
  - 'area:bot-client'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 301000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-07-19 (#1730 review observation) — `PersonalitySummarySchema` (list/browse responses) carries `hasAvatar` but not `avatarUrl`; fine today (no browse surface renders thumbnails), but a future browse-thumbnail feature reaching for `hasAvatar` and hand-building a URL from bot-client's internal gateway base would recreate the exact broken-image bug class #1730 fixed (Discord's media proxy can't reach the internal hostname). **Fix shape**: extend `PersonalitySummarySchema` + the list formatter with the same gateway-derived `avatarUrl` field; never hand-build client-side. **Promote when**: any browse/list surface wants avatar thumbnails.

**Why:** The bug class has bitten twice; the schema field is the structural fix — this row makes the third occurrence impossible to write innocently.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grounding 2026-07-28 (drain, post-#1843): premise drifted — PersonalitySummarySchema today carries NEITHER hasAvatar nor avatarUrl (PERSONALITY_LIST_SELECT is id/name/displayName/slug/ownerId/isPublic/owner.discordId). The real cost is avatar PRESENCE in a 500-row list: avatarData Bytes? is the only signal, and the list SELECT is deliberately blob-free, so delivery needs a design pick — (a) raw SQL avatar_data IS NOT NULL for the list query, or (b) an avatarUpdatedAt DateTime? column (bonus: fixes cache-busting on non-avatar edits too; deriveAvatarUrl currently busts on EVERY row update). Zero consumers today; build with whichever thumbnail/browse feature consumes it, using #1843's avatarUrlPath + identity deriveAvatarUrl (PUBLIC base) — never a client-side hand-build.
<!-- SECTION:NOTES:END -->
