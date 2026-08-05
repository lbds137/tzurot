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
  - 'state:observable'
dependencies: []
priority: low
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`SnapshotFormatter` forwarded references always read as `role="user"`

**Why:** Discord message snapshots strip author identity (no `applicationId` or bot flags), so `SnapshotFormatter.formatSnapshot` can't stamp `authorRole` — a forwarded persona voice/text message reads as `role="user"`, not `assistant`, in the worker's fallback. Known Discord-API limitation (a code comment documents it at the construction site). **Fix shape**: none possible until Discord surfaces author identity on snapshots; if/when it does, classify forwarded refs the same as live refs. **Promote when**: Discord exposes `applicationId`/author-bot flags on message snapshots, OR a forwarded-persona-message self-reply spiral is observed. Surfaced 2026-06-24 by PR #1321 round-3 claude-review.

**Re-verified 2026-07-30 — blocker CONFIRMED, still correctly filed.** Checked
against installed discord.js 14.27.0 rather than assumed: `MessageSnapshot`
(`typings/index.d.ts:7388`) retains exactly attachments · client · components ·
content · createdTimestamp · editedTimestamp · embeds · flags · mentions ·
stickers · type. No `author`, no `applicationId`, no `webhookId` — so the stated
fix ("none possible until Discord surfaces author identity") still holds. Re-check
this list rather than re-deriving the argument when discord.js v15 lands.

**Title is imprecise about the LIVE path.** Forwarded refs read `role="user"` only
on the STORED path (`xmlMetadataFormatters` → `formatStoredReferencedMessage`,
where `authorName` is `UNKNOWN_USER_NAME` and the fallback yields `user`). On the
LIVE path they get NO role attribute at all: `ReferencedMessageFormatter` routes
`isForwarded` to `formatForwardedQuote`, which hardcodes `from: 'Unknown'` and
emits no `role`. Worth knowing before anyone "fixes" the live path expecting to
find a wrong role there.

**Adjacent, and buildable now:** `MessageSnapshot` DOES retain `stickers`, so the
sticker-awareness gap in `SnapshotFormatter` (TASK-359) is not blocked by this
limitation — the data is present, we simply don't read it.
<!-- SECTION:DESCRIPTION:END -->
