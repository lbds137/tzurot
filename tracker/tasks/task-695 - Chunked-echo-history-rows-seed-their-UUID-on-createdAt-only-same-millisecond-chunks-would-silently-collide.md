---
id: TASK-695
title: >-
  Chunked-echo history rows seed their UUID on createdAt only - same-millisecond
  chunks would silently collide
status: To Do
assignee: []
created_date: '2026-08-20 03:51'
updated_date: '2026-09-04 19:38'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `generateConversationHistoryUuid` (`deterministicUuid.ts:240-251`) still seeds on `(channelId, personalityId, userId, createdAt-ms)` with no `discordMessageId`, and the chunked `/chat` echo path still produces N rows per turn distinguished only by chunk timestamp — the same-millisecond collision (silent chunk-drop) is unresolved. Real, if low-probability, data-loss edge case with no consumer-sweep done yet. Evidence: `sed -n '240,251p' packages/common-types/src/utils/deterministicUuid.ts` → seed string has no message-id component.
---
<!-- COMMENTS:END -->
