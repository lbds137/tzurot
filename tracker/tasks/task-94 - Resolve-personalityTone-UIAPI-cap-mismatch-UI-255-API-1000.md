---
id: TASK-94
title: Resolve personalityTone UI/API cap mismatch (UI 255 / API 1000)
status: Done
assignee: []
created_date: '2026-05-06 00:00'
updated_date: '2026-07-28 17:43'
labels:
  - 'area:bot-client'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resolve `personalityTone` UI/API cap mismatch (UI 255 / API 1000)

**Why:** After PR #983's `SHORT_PARAGRAPH_MAX_LENGTH` rename, schema caps `personalityTone` at 1000 but `services/bot-client/src/commands/character/sections.ts:74` caps UI input at 255. Same data-loss vector as PR #983's primary fix: tone 256–1000 stored via direct API gets silently truncated to 255 on dashboard edit. **Three options, all caveated**: (a) bump UI cap to 1000 — UX-questionable for a single-line input; (b) lower API to 255 — requires data audit first; (c) document asymmetry as intentional. **Fix shape pending option**: ~5 LOC for any; option (b) needs preceding audit + migration. **Promote when**: opportunistic during next character-dashboard refactor, OR if a user reports surprising tone truncation. Surfaced 2026-05-06. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified already shipped 2026-07-28: sections.ts personalityTone maxLength is DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH (1000, matching the schema cap), style paragraph, with an in-code comment documenting the old hardcoded-255 truncation bug this task described. Option (a) from the task was implemented at some point without closing the task.
<!-- SECTION:NOTES:END -->
