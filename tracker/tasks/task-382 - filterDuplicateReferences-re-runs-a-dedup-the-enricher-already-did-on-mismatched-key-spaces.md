---
id: TASK-382
title: >-
  filterDuplicateReferences re-runs a dedup the enricher already did, on
  mismatched key spaces
status: To Do
assignee: []
created_date: '2026-08-01 00:13'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 382000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-31 while building TASK-367 (#1883).**

`ResponsePostProcessor.filterDuplicateReferences` drops a reference when `!ref.isDeduplicated && historyIds.has(ref.discordMessageId)`, where `historyIds` is built from `context.rawConversationHistory[].id`. But that `id` is a **DB row UUID** for history rows and a **Discord snowflake** only for extended-context rows (see the comment on `ConversationalRAGTypes.rawConversationHistory.id`). So the comparison can only ever match on the latter — by accident of the two key spaces overlapping in one case.

Meanwhile `enrichRawReferences` (ContextAssembler) has ALREADY decided dedup against the worker-assembled history and set `isDeduplicated`. This is a second, weaker dedup layer running downstream of the real one.

**Why it matters:** anything this filter drops never reaches `formatReferencedMessages`, so as of #1883 it is also never PERSISTED — the reference vanishes from the trigger row entirely rather than being stored and re-deduped at replay (which is what the stored path is designed to do).

**Fix shape:** verify the filter can fire at all (log it for one release, or reason it out from the two producers); if it only ever fires on the extended-context key collision, delete it and let `isDeduplicated` be the single decision. If it does real work, fix the key space.

**Acceptance:** one dedup decision, made in one place, with the key space it compares stated in a comment.
<!-- SECTION:DESCRIPTION:END -->
