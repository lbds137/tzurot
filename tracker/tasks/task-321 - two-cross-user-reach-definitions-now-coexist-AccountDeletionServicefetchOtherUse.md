---
id: TASK-321
title: Two cross-user-reach definitions coexist (deletion vs retention)
status: Done
assignee: []
created_date: '2026-07-24 00:00'
updated_date: '2026-07-29 02:04'
labels:
  - 'area:conversation-history'
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 321000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-24 (retention PR-C #1781 review, non-blocking) — **two cross-user-reach definitions now coexist**: `AccountDeletionService.fetchOtherUserReach` (self-serve delete preview — `memories` only, returns per-character COUNTS) vs `findCrossUserReachIds` (retention — `memories` ∪ `conversation_history` ∪ `memory_facts`, returns IDS). Deliberate and correctly scoped (S3 broadened only the retention signal), but the consequence is user-visible: the self-serve delete warning can tell someone "0 other users have memories with this character" while the retention path would treat that same character as shared and re-home it. **Fix shape**: back `fetchOtherUserReach`'s count with the same three-table union (it already returns a distinct-owner count, so it's a query swap, not a semantic change to self-serve deletion). **Promote when**: the next touch to the self-serve delete preview, or a user reports the warning under-counting.

**Why:** Not a PR-C regression — a pre-existing asymmetry PR-C made legible. The self-serve warning gates a destructive user action, so under-counting there is worth closing eventually.
<!-- SECTION:DESCRIPTION:END -->
