---
id: TASK-695
title: >-
  Chunked-echo history rows seed their UUID on createdAt only - same-millisecond
  chunks would silently collide
status: To Do
assignee: []
created_date: '2026-08-20 03:51'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 695000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2154 round-3 review, low/unverified. generateConversationHistoryUuid seeds on (channelId, personalityId, personaId, createdAt-ms) with no discordMessageId (packages/common-types/src/utils/deterministicUuid.ts:240; derivation at services/api-gateway/src/routes/internal/conversationUserMessage.ts:63). The chunked /chat echo (#2154) makes one turn produce N rows for that tuple, distinguished only by each chunk snowflake ms. If two chunks ever share a millisecond, the replay-dedup path keeps the first row and silently drops the second chunk text from history (existing-row-wins, warn-only), with a log line that reads as an idempotent retry.

Why not fixed in #2154: sends are client-serialized (each awaited channel.send is a full HTTP round trip), so same-ms snowflakes across two sends is speculative; and folding discordMessageId into the seed changes the id scheme for EVERY user-message persist through that route (@mention path included), which needs its own re-derivation-consumer sweep, not a fixup.

Fix shape: sweep for any consumer that RE-derives this UUID from the tuple independently; if none, fold discordMessageId into the seed (replays still dedup - same message id, same UUID) or add a distinctness guard at the gateway. Alternatively record why timestamp-only is accepted, with the probability argument, at the derivation site.

Acceptance: either the seed includes a per-message discriminator with the consumer sweep documented, or the derivation site carries the deliberate-acceptance rationale; the diverged-replay log line distinguishes a genuine retry from a dropped-chunk collision either way.
<!-- SECTION:DESCRIPTION:END -->
