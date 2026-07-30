---
id: TASK-364
title: >-
  Deduped references drop image descriptions — vision spend is computed then
  discarded
status: To Do
assignee: []
created_date: '2026-07-30 22:35'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 364000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Runtime-confirmed 2026-07-30 (prod, owner-reported).**

When a user posts an image/embed message WITHOUT triggering the bot, then replies to it to trigger, the reference's images are vision-described successfully — and the descriptions never reach the model.

**Evidence (prod ai-worker, 2026-07-30T22:24:47Z, job image-823aead4-...-ref1-image):**
- `Processing image description job ... imageCount=4`
- 4x `Invoking vision model ... qwen/qwen3.7-plus`
- `Image description completed ... processingTimeMs=47774 imageCount=4` (SUCCESS)
- `DependencyStep ... referencedAttachmentCount=4 totalPreprocessed=4` (available to the pipeline)
- Rendered prompt shows bare `[image/png: embed-image-1..4.png]` placeholders

**Mechanism (code-verified):** the deduped-reference branch passes only `content` and does no attachment processing — explicit code comment says so — in BOTH renderers (`ReferencedMessageFormatter` live path, `xmlMetadataFormatters` dedupedRefs.map stored path). `persistReferenceDescriptions` exists to prevent exactly this bare-marker symptom, but it writes `resolvedImageDescriptions`, which only the NON-deduped stored path reads.

The stub's premise — "full text in the chat log" — is FALSE for embed images: the chat-log copy renders raw `<embed><image url>` with no descriptions.

**Cost angle, the sharpest framing:** this is worse than not describing. We pay 4 vision calls and 47.8s of latency, then discard the result.

**NOT from beta.187:** dedup-skips-attachments is commit b1db45b06 (2026-02-15), an ancestor of v3.0.0-beta.186. #1872's MessageContentBuilder change is purely additive (appends stickerImages); the embed path is untouched.

**Same class as TASK-162** (role dropped on the deduped path, since fixed) — the deduped path keeps losing fields.

**Fix shape is a DESIGN CALL, owner-gated:** (a) thread descriptions into the deduped stub (costs tokens, but they are NOT duplicated since history lacks them); (b) make history carry embed-image descriptions so the stub premise becomes true; (c) do not dedup messages whose images are undescribed in history.
<!-- SECTION:DESCRIPTION:END -->
