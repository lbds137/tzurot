---
id: TASK-837
title: >-
  Embed thumbnails render as intentional user attachments — character misreads
  the gesture
status: Done
assignee: []
created_date: '2026-08-31 01:49'
updated_date: '2026-08-31 14:44'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 837000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-08-31 (debug 9a441f59, request in a live guild): user shared a YouTube Music link; the character replied "Look at what you actually sent: a face woven out of night…" — treating the auto-embed thumbnail as a deliberately sent image. The user sent a link; Discord generated the preview.

Mechanism, verified in the trace + source:
- bot-client converts embed images/thumbnails into SYNTHETIC AttachmentMetadata (extractEmbedImages, services/bot-client/src/utils/embedImageExtractor.ts:21) named embed-thumbnail-N.png, which then travel the normal attachment pipeline.
- Every prompt surface renders them indistinguishably from user uploads: [Image: name] in the live message (formatProcessedAttachmentEntry, services/ai-worker/src/services/RAGUtils.ts:103-111) and "Attachments: - Image (name): desc" in reference renderers.
- The S0 media-description constraint (services/ai-worker/src/services/prompt/HardcodedConstraints.ts:124) then asserts "The participant shared the media" — which for a link preview is precisely the misread it should prevent.

Fix shape — the STICKER PRECEDENT, same file: RAGUtils.ts:107-110 already carves stickers out of the [Image:] header because "labelling it [Image: …] would tell the character someone uploaded a file when they picked a sticker, which changes how it reads the gesture". Embed previews are the same class:
1. Add a flag on AttachmentMetadata (like isSticker) — e.g. isEmbedPreview — set by extractEmbedImages; do NOT name-sniff embed-thumbnail-*.png (heuristic, and reuse-scout says registries over sniffing).
2. formatProcessedAttachmentEntry renders a distinct header, e.g. [Link preview: name].
3. Sweep the reference render matrix too — RenderableReference/QuoteFormatter/storedReference ((deduped x full) x (live x stored), the ReferencedMessageFormatter matrix) — this is the two-way branch-beside-sibling sweep.
4. Amend the HardcodedConstraints.ts:124 constraint: link-preview descriptions describe the preview Discord attached to a link the participant shared, not media they chose to upload.

Adjacent observation, not its own task: a STORED 2025-11 reference in the same trace carries an in-character vision description ("*Leaning forward with a grin, I trace the neon edges…*") baked into history — legacy data from before the neutral-description era; the live path in this trace produced a clinical description. No action beyond knowing old rows look like that.

Acceptance: an embed thumbnail renders under a link-preview header (not [Image:]) at every surface in the render matrix; the S0 constraint distinguishes uploaded media from link previews; a test pins the header split the way the sticker split is pinned.
<!-- SECTION:DESCRIPTION:END -->
