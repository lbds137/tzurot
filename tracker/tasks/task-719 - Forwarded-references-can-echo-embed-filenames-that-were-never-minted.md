---
id: TASK-719
title: Forwarded references can echo embed filenames that were never minted
status: To Do
assignee: []
created_date: '2026-08-21 20:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 719000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the TASK-667 binding work. In services/bot-client/src/handlers/references/MessageFormatter.ts, the forwarded branch of resolveMessageContent (:41-46) builds attachments from extractForwardedAttachments (snapshot embeds only), while buildRawReferencedMessage emits embeds: EmbedParser.parseMessageEmbeds(message) (:117) over the WRAPPER message own embeds unconditionally. Two consequences when a forwarded reference wrapper carries its own image-bearing embed: (1) the echoed filename attribute points at an attachment this path never mints -- a dangling join key (the wrapper embed images were never extracted here before TASK-667 either, so no description regresses -- the echo just makes the gap visible); (2) worse, names are index-derived per array, so a wrapper embed-1 echo can COLLIDE with a snapshot-minted embed-1-image.png attachment, binding a description to the wrong embed.

Fix shape needs a decision: either extract wrapper embed images on the forwarded branch too (parity with MessageContentBuilder, which extracts both snapshot and message.embeds), or suppress the filename echo for forwarded-wrapper embeds. Parity is likely the cleaner call but adds vision cost for a rare shape.

Acceptance: for a forwarded reference whose wrapper carries an image-bearing embed, every filename attribute emitted in the embeds XML corresponds to exactly one minted attachment of that name, and no echoed name collides across the wrapper/snapshot arrays.

SECOND TRIGGER, same class (added from PR 2174 review round 2): a COMPOUND forward (one Discord action forwarding multiple messages -> multiple entries in message.messageSnapshots) collides snapshot-vs-snapshot, not just wrapper-vs-snapshot. MessageContentBuilder.buildMessageContent (~:249-268) and extractForwardedAttachments (forwardedMessageUtils.ts) both walk snapshots per-snapshot with the embed index restarting at 0, pushing into ONE flat embedsXml / attachments surface -- two snapshots each carrying an embed image both mint embed-1-image.png, so two embed blocks echo the same filename against two different vision descriptions. Pre-existing under the old counter too (it restarted per extractEmbedImages call). Any fix must cover BOTH triggers -- e.g. scoping the name by snapshot ordinal for snapshot-minted attachments -- and the acceptance below already reads across arrays, so it covers this case as written.
<!-- SECTION:DESCRIPTION:END -->
