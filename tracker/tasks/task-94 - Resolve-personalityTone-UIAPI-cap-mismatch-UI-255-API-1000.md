---
id: TASK-94
title: 'Resolve personalityTone UI/API cap mismatch (UI 255 / API 1000)'
status: To Do
assignee: []
created_date: '2026-05-06 00:00'
labels:
  - 'area:bot-client'
  - 'area:db'
dependencies: []
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Resolve `personalityTone` UI/API cap mismatch (UI 255 / API 1000)

**Why:** After PR #983's `SHORT_PARAGRAPH_MAX_LENGTH` rename, schema caps `personalityTone` at 1000 but `services/bot-client/src/commands/character/sections.ts:74` caps UI input at 255. Same data-loss vector as PR #983's primary fix: tone 256–1000 stored via direct API gets silently truncated to 255 on dashboard edit. **Three options, all caveated**: (a) bump UI cap to 1000 — UX-questionable for a single-line input; (b) lower API to 255 — requires data audit first; (c) document asymmetry as intentional. **Fix shape pending option**: ~5 LOC for any; option (b) needs preceding audit + migration. **Promote when**: opportunistic during next character-dashboard refactor, OR if a user reports surprising tone truncation. Surfaced 2026-05-06. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->
