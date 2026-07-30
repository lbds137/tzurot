---
id: TASK-355
title: Describe stickers and polls in message context (like embeds)
status: To Do
assignee: []
created_date: '2026-07-30 02:45'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 355000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: A sticker-only or poll message reaches the model as effectively empty content — DiscordChannelFetcher serializes embeds (embedsXml) and attachments (vision/STT) but has zero sticker/poll handling (grep-confirmed 2026-07-29), so characters silently miss a whole message shape users send routinely.
Fix shape: render sticker name/description and poll question+options into the message context the same way embeds ride embedsXml; extend the fetcher + metadata schema + xmlMetadataFormatters. No event plumbing needed — pure context fidelity at fetch time.
Surfaced by the literal-goose/raccoon diegetic-events review (owner exchange 2026-07-29); independent of the deletion/reaction-stimulus idea doc.
<!-- SECTION:DESCRIPTION:END -->
