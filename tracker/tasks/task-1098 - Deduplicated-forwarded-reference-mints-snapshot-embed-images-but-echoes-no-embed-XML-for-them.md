---
id: TASK-1098
title: >-
  Deduplicated forwarded reference mints snapshot embed images but echoes no
  embed XML for them
status: To Do
assignee: []
created_date: '2026-09-25 06:23'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1091000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the #2528 review (TASK-719). On the DEDUPLICATED forwarded-reference path (ReferenceFormatter.appendSingleReference -> MessageFormatter.buildRawReference -> the forwarded branch of resolveMessageContent), extractForwardedAttachments mints forward-K-embed-N-... names for snapshot embed images and the vision pipeline describes them, but the reference embeds field is EmbedParser.parseMessageEmbeds(message) over the WRAPPER only and extractForwardedContentForPrompt renders no snapshot <embed> XML, so those descriptions have no echoed filename to bind to. Pre-existing (the unscoped names had the same gap); the non-deduplicated path (SnapshotFormatter.formatSnapshot) renders the XML and is fine.
Fix shape: on the forwarded branch of resolveMessageContent, render the snapshot embeds as <embed> XML with the snapshot scope (reuse the formatEmbedElement loop SnapshotFormatter.formatSnapshot uses, scoped per snapshot) and append it to the reference embeds field, so every minted name has exactly one echo. Verify by grep that the deduplicated arm is the only path with this asymmetry.
Acceptance: a deduplicated forwarded reference whose snapshot carries an image embed has that embed echoed as XML with the forward-K-embed-N name, pinned by a test in MessageFormatter.test.ts; the property echoed set equals minted set holds on that branch.
<!-- SECTION:DESCRIPTION:END -->
