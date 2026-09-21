---
id: TASK-1030
title: Components-V2 renderer flattens per-Section text/media pairing
status: To Do
assignee: []
created_date: '2026-09-21 03:16'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1024000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: formatEmbedComponentsXml (services/bot-client/src/utils/embedComponents.ts) collects every TextDisplay across the tree, then every media item, so an unfurl holding several Sections each with its own Thumbnail accessory renders all text lines before all image lines and loses which image belongs to which text. Correct for the only observed shape (one Container, three TextDisplays, one MediaGallery) and documented in the function doc; not correct for a multi-Section tree.
Fix shape: walk the tree once in document order emitting text and image lines as encountered (a Section renders its text then its accessory image), keeping the embed-N-media-M naming in document order so the vision join key is unchanged; pin with a two-Section fixture asserting the interleaved order.
Promote when: a production unfurl (EmbedShapeDiagnostics or an /inspect payload) shows a Components-V2 tree with more than one Section, or any Section plus a MediaGallery in one Container.
Acceptance: the two-Section fixture renders text1, image1, text2, image2; the single-container fixture output is unchanged.
<!-- SECTION:DESCRIPTION:END -->
