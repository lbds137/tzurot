---
id: TASK-127
title: '3-second ack-rule violation in memory handleEditButton'
status: To Do
assignee: []
created_date: '2026-05-28 00:00'
labels:
  - 'area:bot-client'
  - 'area:db'
dependencies: []
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

3-second ack-rule violation in memory `handleEditButton`

**Why:** `services/bot-client/src/commands/memory/detailModals.ts` `handleEditButton` calls `fetchMemory` (one gateway round-trip) BEFORE any `interaction.reply` / `showModal` ack. Per `04-discord.md` "the first await in a component handler must be on `interaction.deferUpdate()`" — async work must follow an ack, not precede it. The handler currently absorbs the entire 3-second interaction budget on the API call; users on a slow gateway will see "Interaction failed." Pre-existing behavior (preserved through the PR-2h typed-client migration; same race existed under the old `callGatewayApi` shape). **Fix shape**: cannot use `deferUpdate` directly because the success path is `showModal`, which is forbidden after defer. Two options: (a) skip the pre-fetch — pre-fill the modal with a placeholder and load the content asynchronously via `interaction.message.edit` after the modal is shown; (b) refactor to surface a "loading" embed first, then defer + showModal once the fetch is done (UX change). The sibling `handleEditTruncatedButton` and `handleEditModalSubmit` paths have the same shape and should be fixed alongside. **Promote when**: a user reports the "Interaction failed" UX OR opportunistically on next memory-detail refactor pass. Surfaced 2026-05-28 by PR #1111 round-4 claude-bot review (flagged as pre-existing). Deferred 2026-05-28.
<!-- SECTION:DESCRIPTION:END -->
