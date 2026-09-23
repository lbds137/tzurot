---
id: TASK-1053
title: >-
  Spoilered Components-V2 gallery items reach vision as link previews without
  the spoiler flag
status: To Do
assignee: []
created_date: '2026-09-23 05:10'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1047000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1031 (PR for feat/task-1031-spoiler-attachment-label) labels spoilered plain uploads with isSpoiler on AttachmentMetadata, rendered as a "[Spoiler image: name]" header and spoiler="true" on <image> elements. A Components-V2 MediaGallery item the poster marked as a spoiler already renders spoiler="true" in the embed XML (services/bot-client/src/utils/embedComponents.ts), but the synthetic vision attachment built for it in services/bot-client/src/utils/embedImageExtractor.ts carries isEmbedPreview and no isSpoiler, so its [Link preview: ...] header and attachment <image> element carry no spoiler marker. Found by the TASK-1031 orchestrator; left out because that task kept the embed path unchanged.
Fix shape: set isSpoiler from the gallery item spoiler field in extractEmbedImages; decide whether a spoilered link preview header reads "[Link preview: name]" with spoiler="true" on the element, or a distinct label (imageHeaderLabel precedence puts link-preview first today). Pin both in embedImageExtractor.test.ts and the RAGUtils header test.
Acceptance: a spoilered gallery item yields an attachment with isSpoiler true and its rendered <image> element carries spoiler="true"; a non-spoiler gallery item is unchanged.

Second member (claude-review on PR #2486): bot-client extractAttachments sets isSpoiler for EVERY spoilered attachment kind, but only the image render consumes it (imageHeaderLabel / imageSpoiler in common-types attachmentProvenance.ts). A spoilered file or voice memo carries the flag with no label: renderAttachment's voice and file branches in services/ai-worker/src/services/prompt/QuoteFormatter.ts, and generateAttachmentPlaceholder's audio/file branches in bot-client attachmentPlaceholders.ts, never read it. The owner ruling of 2026-09-22 ("label spoilered plain attachments") plausibly covers these too, but that is unconfirmed. Fix: a spoiler marker on the file and voice headers and elements, with the same shape as the image one. If the label vocabulary is not obvious, ask the owner first.

Owner ruling 2026-09-23 (same rule everywhere): a spoilered file reads "[Spoiler file: name]" and spoilered audio "[Spoiler audio: name]", each with spoiler="true" on its element; a spoilered gallery image keeps its "[Link preview: name]" header (it states provenance) and gains spoiler="true" on the element. Voice messages get the same treatment if Discord lets one carry the spoiler flag (unverified at ruling time; check before building).
<!-- SECTION:DESCRIPTION:END -->
