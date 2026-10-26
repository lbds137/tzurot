---
id: TASK-1295
title: Deny one-pick select is silent when the entry fetch fails
status: To Do
assignee: []
created_date: '2026-10-26T09:56:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2661 round-3 claude-review. handleBrowseSelect in services/bot-client/src/commands/deny/browse.ts returns with no user feedback after its ack when fetchEntries returns null, while handleBrowsePagination in the same file answers through followUpBrowsePageFailure and the new batch paths answer with PAGE_FETCH_FAILED_COPY.

What: call followUpBrowsePageFailure(interaction, null) on that null branch, matching handleBrowsePagination.

Riders from PR 2661 round 5 (same deny files, text-only): in services/bot-client/src/commands/deny/browseBatch.ts, rewrite the garbled runSingleDenyRemoval doc bullet (entry absent from a capped fetched list (listTruncated) (a list at the cap counts, see listTruncated)) to one clause, and wrap the single ~170-char comment above const listTruncated to the file width; in browseBatch.test.ts, drop the C-number and Hardening process labels from describe/it titles so they name behaviour only.

Rider from the TASK-1291 slice-a review (2026-10-26): handleDenyBatchConfirm in browseBatch.ts runs ackUpdate before any guard, so a rejecting ack escapes unlogged; move it inside the prep try with the handleOverrideBatchConfirm shape (log ids, ephemeral followUp with .catch, sent only when interaction.deferred or interaction.replied since discord.js followUp throws on an unacked interaction; else log only) and add a rejecting-ack test whose followUp mock enforces that precondition. PREMISE CHECK (2026-10-26, TASK-1291 slice c grounding): "escapes unlogged" looks false. A throw out of any component handler reaches CommandHandler.handleComponentInteraction's catch (services/bot-client/src/handlers/CommandHandler.ts), which logs at error level with the customId and replies through replySpecSafe; that reply is ack-aware and swallows a failed send. The memories and facts riders were ruled out for this reason. Re-read that catch at grounding; unless deny bypasses CommandHandler, rule this rider out the same way.

Acceptance: a test where listDenylistEntries fails on a one-pick select sends the page-load failure followUp; the riders land in the same PR.
<!-- SECTION:DESCRIPTION:END -->
