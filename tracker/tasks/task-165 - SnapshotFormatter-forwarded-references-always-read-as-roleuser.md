---
id: TASK-165
title: SnapshotFormatter forwarded references always read as role="user"
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`SnapshotFormatter` forwarded references always read as `role="user"`

**Why:** Discord message snapshots strip author identity (no `applicationId` or bot flags), so `SnapshotFormatter.formatSnapshot` can't stamp `authorRole` — a forwarded persona voice/text message reads as `role="user"`, not `assistant`, in the worker's fallback. Known Discord-API limitation (a code comment documents it at the construction site). **Fix shape**: none possible until Discord surfaces author identity on snapshots; if/when it does, classify forwarded refs the same as live refs. **Promote when**: Discord exposes `applicationId`/author-bot flags on message snapshots, OR a forwarded-persona-message self-reply spiral is observed. Surfaced 2026-06-24 by PR #1321 round-3 claude-review.
<!-- SECTION:DESCRIPTION:END -->
