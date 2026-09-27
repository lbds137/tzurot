---
id: TASK-1116
title: >-
  Quoted/forwarded plain audio-only WebM still renders as a file stub (TASK-1112
  sibling flow)
status: Done
assignee: []
created_date: '2026-09-27 09:06'
updated_date: '2026-09-27 11:39'
labels:
  - 'area:ai-worker'
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1112 routes a plain (unflagged) `video/webm` upload whose bytes are audio-only WebM to STT in the chat path (`MultimodalProcessor.processSingleAttachment` via `multimodal/plainWebmAudioSniff.ts`). The sibling flow for referenced, quoted and forwarded messages does not go through that function: `AttachmentProcessor.processAttachmentsParallel` classifies via `classifyAttachment` (`services/prompt/QuoteFormatter.ts` ~127), which still calls a plain `video/webm` a `file`. So quoting or forwarding a plain voice re-upload still renders the unsupported-file stub. Found by the TASK-1112 orchestrator (outward sweep), not observed in prod.

What: route the quoted/forwarded path through the same sniff: when `classifyAttachment` would return `file` for a plain `video/webm` within `PLAIN_WEBM_SNIFF_MAX_BYTES`, sniff it and treat an audio-only result as audio (reuse `sniffPlainWebmForAudioOnly` and pass the bytes as `transcribeAudio`'s `prefetched`). Check whether the reference path downloads bytes before classification (DownloadAttachmentsStep covers trigger and extended attachments; confirm for references).

Acceptance: a quoted/forwarded plain audio-only WebM yields a transcript in the reference block; one with a video track stays a file; a test in the reference path pins both, plus a seam test through the real sniff.
<!-- SECTION:DESCRIPTION:END -->
