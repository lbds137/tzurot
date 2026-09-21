---
id: TASK-1032
title: 'Bound the Components-V2 embed walk: nesting depth and gallery item count'
status: To Do
assignee: []
created_date: '2026-09-21 10:13'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1026000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: embedComponents.ts (services/bot-client/src/utils/embedComponents.ts) walks the embed components tree recursively through Container and Section children with no depth cap, and extractEmbedImages emits one vision attachment per collected gallery item with no per-embed count cap. The tree arrives from the Discord API (Discord own unfurl service is the producer), and the aggregate download cap in DownloadAttachmentsStep.ts still bounds total bytes, so both are theoretical today; the MEDIA_LIMITS comment in packages/common-types/src/constants/media.ts sizes for up to 20 attachments per message and nothing enforces that count for gallery media. Surfaced by the PR #2461 round-5 review as informational.
Fix shape: pass a depth counter through collectEmbedComponentText and collectEmbedComponentMedia and stop descending past a small constant (Discord components allow one level of Container plus Section, so 4 is generous); cap collected media per embed at a named constant beside EMBED_NAMING and drop the rest in document order; pin both with a deep-nesting fixture and an over-cap gallery fixture.
Acceptance: a fixture nested past the cap renders only the levels within it without throwing; a gallery over the cap yields exactly the cap count of attachments and image lines, numbered in document order.
<!-- SECTION:DESCRIPTION:END -->
