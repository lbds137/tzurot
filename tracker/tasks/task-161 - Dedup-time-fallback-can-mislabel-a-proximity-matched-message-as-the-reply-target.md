---
id: TASK-161
title: >-
  Dedup time-fallback can mislabel a proximity-matched message as the
  reply-target
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Dedup time-fallback can mislabel a proximity-matched message as the reply-target

**Why:** `isDuplicateReference`'s time-based fallback (`referenceEnrichment.ts`) marks a reference `isDeduplicated` when a recent webhook/bot message falls within `MESSAGE_TIMESTAMP_TOLERANCE` — by timestamp proximity, not exact id. If the proximity-matched history row isn't the exact message being replied to, the deduped stub's marker (`[Referenced message — full text in <chat_log>]`) points at text that isn't actually in `<chat_log>`. Pre-existing — PR #1317 didn't change the fallback; low probability (tight tolerance). **Fix shape**: prefer exact-id match and only fall back to proximity when no id match exists, or drop the "full text in chat_log" marker when the match was proximity-based. **Promote when**: a mismatched-reference incident is observed, or when reworking the dedup fallback. Surfaced 2026-06-23 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): RETARGET. The shared isDuplicateReference kernel now lives in packages/common-types/src/utils/referenceEnrichment.ts. Premise intact: exact-id and timestamp-proximity matches collapse into one boolean, so a caller cannot tell which justified the reference claim.
---
<!-- COMMENTS:END -->
