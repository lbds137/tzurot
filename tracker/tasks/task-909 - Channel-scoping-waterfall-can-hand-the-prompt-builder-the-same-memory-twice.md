---
id: TASK-909
title: Channel-scoping waterfall can hand the prompt builder the same memory twice
status: Done
assignee: []
created_date: '2026-09-07 17:54'
updated_date: '2026-09-08 03:51'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 907000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: waterfallMemoryQuery (services/ai-worker/src/services/PgvectorChannelScoping.ts, the combinedResults concat of channelResults and globalResults) excludes only the channel pass primary hits from the global pass (excludeIds reaches the vector WHERE in PgvectorQueryBuilder.ts only), while each pass runs its own sibling expansion that refetches whole chunk groups with no exclusion. A chunk sibling that straddles both passes therefore appears twice in what the caller receives, and the prompt builder can render one memory twice, spending budget and repeating a note. Surfaced by claude-review round 3 on PR 2357, which fixed the same straddle for the retrieval stamp (the stamp dedupes by id) but not for the documents themselves. Code-read only; not runtime-confirmed with a debug payload.
Fix shape: dedupe combinedResults by metadata.id in waterfallMemoryQuery before returning (keep the channel-pass instance first for prominence), with a unit test whose channel pass returns chunk A of a group and whose global pass expansion returns A and C, asserting one A in the output; check whether MemoryRetriever or the budget manager already dedupes by chunk group downstream before claiming the bug reaches the prompt.
Acceptance: the waterfall returns each memory id at most once; a debug payload from a channel-scoped turn with a straddling group shows the note once.
Shipped in #2366 with a correction to the premise above: after a successful channel-pass sibling expansion every member of a touched group is in excludeIds (channelResults is the post-expansion list), so the global pass cannot re-hit that group. The straddle is reachable when the channel pass fetchChunkSiblings throws for a group (caught and swallowed in expandWithSiblings), after which the global pass can hit another member and expand the whole group. Code-read, not runtime-confirmed either way; the dedupe holds regardless.
<!-- SECTION:DESCRIPTION:END -->
