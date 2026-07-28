---
id: TASK-322
title: Purge over-retains ex-public private characters (owner-accepted disposition)
status: To Do
assignee: []
created_date: '2026-07-25 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 322000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-25, **DISPOSITIONED 2026-07-25 (owner)** — a purge preserves a character with cross-user reach, and `findCrossUserReachIds` never checks `isPublic`, so a character that was public, accumulated another user's history, then went private is **kept** (re-homed to the sentinel, where only the bot owner can reach it). **Owner accepted the over-retention**: the alternative — treating a currently-private character as unreached and deleting it — also deletes the OTHER users' memory/history/fact rows scoped to it, for people who never asked for a deletion and can no longer reach the character to notice. Retaining a dead character beats deleting someone else's data. Recorded in `AccountDeletionService`/`reHome.ts` so the next reader doesn't 'fix' it. **Promote when**: a measured count shows the retained set is material, or reclamation (Phase 3) gives these characters a way back to a real owner.

**Why:** Live, deliberate behaviour of the shipped purge — kept on the board as a disposition, not a defect.
<!-- SECTION:DESCRIPTION:END -->
