---
id: TASK-714
title: >-
  Embed XML emits the original image URL while the vision path fetches the proxy
  URL
status: To Do
assignee: []
created_date: '2026-08-21 15:00'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 714000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced while grounding TASK-667, which needs it as one input but does not fix it and whose acceptance does not cover it. Left inside that description it dies when 667 closes.

The divergence, both halves verified from source: services/bot-client/src/utils/embedImageExtractor.ts:29 and :39 build the synthetic vision attachment from embed.image.proxyURL ?? embed.image.url, deliberately, because services/ai-worker/src/utils/attachmentFetch.ts:23 restricts ALLOWED_HOSTS to cdn.discordapp.com and media.discordapp.net. services/bot-client/src/utils/EmbedParser.ts:104 and :109 emit the ORIGINAL embed.image.url and embed.thumbnail.url into the prompt XML. For any externally-hosted embed (Reddit, Imgur, a news site) those are different URLs, so the prompt shows the model a URL our own fetch layer would refuse.

NOT ESTABLISHED, deliberately: whether anything downstream ever fetches the URL out of the embed XML. Grep found the guard applied on the character import, avatar and voice paths only, not on an embed-XML consumer. If nothing fetches it, this is a consistency and provenance question rather than a failure, which is why this is filed as a question and not as a bug.

What to decide: whether the embed XML should carry the proxy URL (matching what we actually fetched and describe), the original (matching what a human clicking through would get), or both under distinct attributes. Note the two are not interchangeable for the model either, since the proxy URL is the one that corresponds to the image we generated a description of.

Acceptance: the choice is made with its reason recorded, applied to both the image and thumbnail slots, and pinned by a test asserting which URL reaches the XML for an externally-hosted embed.
<!-- SECTION:DESCRIPTION:END -->
