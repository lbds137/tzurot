---
id: TASK-966
title: >-
  A channel-scoped /history purge writes a persona-global context epoch,
  silently emptying cross-channel history everywhere
status: To Do
assignee: []
created_date: '2026-09-13 18:02'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: high
ordinal: 963000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-13 on dev. After running /history purge in a two-message test thread, every later payload in that thread showed the cross-channel feed enabled but empty (crossChannelMessagesIncluded: 0, where the same thread had pulled 100 messages across four channels that morning), and the settings dashboard showed Cross-Channel History enabled. Mechanism, grounded: the purge handler (services/api-gateway/src/routes/user/history.ts, the block after retentionService.clearHistory, ~370-385) upserts user_persona_history_configs with lastContextReset = now and previousContextReset = null. That table is keyed by (user, personality, persona) with no channel column, and every history fetch — the current channel AND getCrossChannelHistory in packages/conversation-history ConversationHistoryService (~397-405, computeHistoryCutoff → createdAt >= cutoff) — applies it. So a purge meant for one thread hides every older message in every channel for that persona and character. Nothing in the purge confirmation says so, /inspect does not show the epoch, and the owner relies on the cross-channel feed as a week-long continuity window (doc-97 Phase 4 design brief), so the loss reads as the feature silently breaking. Recovery today: /history undo — the purge stored previousContextReset = null, so undo sets lastContextReset back to null, the no-clear state.
Fix shape — an owner design call between two shapes, then build the chosen one: (a) the purge stops writing the epoch at all — its rows are already deleted by clearHistory, so the epoch adds nothing for the purged channel and only damages the others; check whether the epoch write was added for a reason the delete does not cover (synced rows arriving later? the undo count feature from beta.222?) by reading the git log for that block before removing it; or (b) the epoch gains a channel scope (nullable channel_id on user_persona_history_configs, additive migration; the cutoff helper takes the channel; a null-channel epoch keeps today’s persona-wide meaning for /history clear) so purge writes a channel-scoped epoch. Either way: the purge and clear confirmations state the scope of what becomes hidden (this channel vs every channel for this character), and TASK-965 (resolved overrides in the debug payload) should carry the active epoch so the next occurrence is readable from /inspect. Sibling check: /history clear intentionally writes a persona-wide epoch — confirm with the owner that clear staying persona-wide is the intended semantics, and say so in the confirmation text.
Owner question: should a channel-scoped /history purge stop writing the context epoch (the rows are already deleted), or should the epoch gain a channel scope so purge hides only that channel?
Recommendation: stop writing it on purge (shape a) — no migration, the delete already does the purge’s job, and clear keeps its persona-wide epoch for the explicit whole-history reset; pick (b) only if the git log shows the epoch write covered a case the delete does not.
Acceptance: after a channel-scoped purge, a payload from another channel for the same persona and character still includes the older cross-channel messages; the purge confirmation names the scope of what becomes hidden; a unit test pins that purge no longer changes (or now channel-scopes) the epoch; the debug payload shows the active epoch.
<!-- SECTION:DESCRIPTION:END -->
