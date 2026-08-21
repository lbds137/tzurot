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
ORCHESTRATOR GROUNDING 2026-08-20, resolving the pick-deliberately fork. Three facts the filing does not carry, all read from source:

1. The class is FOUR call sites, not one. extractEmbedImages and EmbedParser sit side by side in MessageContentBuilder.ts (two regions, ~261 and ~290/336), SnapshotFormatter.ts:75/102, MessageFormatter.ts:49/117, and forwardedMessageUtils.ts:209/266. Each computes its own numbering independently. Any binding must be applied at all four or the unfixed ones keep the inference.

2. A URL join is NOT available. extractEmbedImages prefers embed.image.proxyURL (embedImageExtractor.ts:30, deliberately, to satisfy the CDN allowlist), while EmbedParser emits the ORIGINAL embed.image.url (EmbedParser.ts:104). For any externally-hosted embed those differ, so the two halves share no key at all today except the filename. Worth its own look: the embed XML hands the model a URL our own allowlist would reject. NOW FILED SEPARATELY as TASK-714 -- it is an input to this task, not part of it, and this acceptance does not cover it.

3. The filename convention is not merely inferred, it is AMBIGUOUS. The synthetic name counter (imageAttachments.length + 1) runs across every embed in the message and is incremented by BOTH the image and the thumbnail slot, so with two embeds, or one embed carrying both slots, the numbering interleaves in a way the per-embed XML gives the model no way to reconstruct.

DECISION - neither of the two options as filed. Make the synthetic name deterministic from the embed INDEX plus the SLOT (embed-1-image, embed-1-thumbnail) rather than a shared running counter, then echo it as a filename attribute on the embed's own image element. Both producers can then derive the same name independently from the same embed index with no coupling between them, EmbedParser already knows the index (it emits numAttr from it), and the ambiguity in fact 3 disappears rather than being papered over.

Not the inline form, for a dated-out reason rather than cost: embedsXml becoming structured is exactly what doc-17 Phase 2 is building (prompt-assembly-architecture.md section 9c, the StructuredHistoryEntry IR). Restructuring it here would collide with that work. The join key is forward-compatible - Phase 2 absorbs it and can delete it once the IR makes inlining free.

Sequencing note: this renames a synthetic attachment filename that appears in prompt output, so expect snapshot churn.
<!-- SECTION:DESCRIPTION:END -->
