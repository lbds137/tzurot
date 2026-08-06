---
id: TASK-75
title: discordCdnGuard non-https failure-reason variant
status: Done
assignee: []
created_date: '2026-04-26 00:00'
updated_date: '2026-08-06 08:58'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`discordCdnGuard` non-https failure-reason variant

**Why:** `validateDiscordCdnUrl` returns `{ ok: false, reason: 'invalid-url' }` for both `http://cdn.discordapp.com/...` (correct host, wrong protocol) and `not-a-url` (URL constructor throws). Tagged-union accuracy nit: a future caller wanting to log "known host but http" differently has no way to distinguish. **Fix shape**: add `reason: 'non-https'` as a third failure variant. Low priority — current 4 callers (avatar/voice/import/jsonFileUtils) all just check `cdnGuard.ok`. **Why deferred**: no current consumer cares about the distinction; revisit when a consumer needs differentiated logging/UX. Surfaced 2026-04-26 by claude-bot review on #905 final round. Deferred 2026-04-26.
<!-- SECTION:DESCRIPTION:END -->
