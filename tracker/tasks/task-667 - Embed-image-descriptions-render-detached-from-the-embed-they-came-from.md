---
id: TASK-667
title: Embed image descriptions render detached from the embed they came from
status: To Do
assignee: []
created_date: '2026-08-19 00:46'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 667000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner-reported from a live prod prompt (2026-08-18). A forwarded tweet rendered as an <embed> carrying <title>/<description>/<image url="..."/>, and then a SEPARATE sibling <attachments> block holding <image filename="embed-image-1.png">A four-panel vertical composite...</image>. Nothing binds the two but a filename convention the model has to infer, so the description reads as an unrelated image rather than as the embed content it describes.

Mechanism: services/bot-client/src/utils/embedImageExtractor.ts lifts embed.image.proxyURL into a SYNTHETIC AttachmentMetadata named embed-image-N.png purely so the vision pipeline will describe it. The embed XML (bot-client EmbedParser, pre-formatted) keeps only the URL; the description arrives later from ai-worker enrichment and lands in the attachments wrapper. Both halves are correct in isolation.

The codebase already argues against this shape one level down: the formatQuoteElement docstring in services/ai-worker/src/services/prompt/QuoteFormatter.ts rejects putting the same object in two unrelated vocabularies and forcing consumers to correlate the two halves by filename. That reasoning was applied within attachments and never carried across the embed boundary.

Fix shape, and the reason this is size M rather than S: the clean form is inline -- <image url="..." >description</image> inside the embed -- but embedsXml is a PRE-FORMATTED string produced in bot-client while the description is produced later in ai-worker, so inlining needs embedsXml to become structured, or needs a splice into formatted XML (do not do the splice). The cheap alternative is an explicit join key (from_embed="1" on the attachment element, or the filename echoed on the embed image element), which keeps the split but removes the inference. Pick deliberately; do not default to the cheap one because it is cheap.

Related but NOT the same: TASK-378 aligns MESSAGE-level media vocabulary with the quote-level attachments shape. That is a vocabulary axis; this is a binding axis, and it survives whichever vocabulary wins.

Acceptance: an embed-derived image description is bound to its embed without the model inferring a filename convention, at both quote and message level; the chosen binding is recorded with its reason; guard:prompt-tags still classifies every emitted tag.
<!-- SECTION:DESCRIPTION:END -->
