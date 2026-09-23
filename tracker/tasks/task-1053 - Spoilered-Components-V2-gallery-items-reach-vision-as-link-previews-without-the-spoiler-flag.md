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
<!-- SECTION:DESCRIPTION:END -->
