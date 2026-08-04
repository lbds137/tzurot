---
id: TASK-421
title: Render AttachmentType.File stubs in the deduped-reference quote path
status: To Do
assignee: []
created_date: '2026-08-04 02:48'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 421000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildDedupedAttachments (ReferencedMessageFormatter) re-renders only Image/Audio entries; a File-stub entry on a quoted message is dropped with warnOnDroppedEnrichment instead of rendering its honest [File: name] line. Pre-existing bucket, tripwired by the RenderableFile comment; PR 1934 review flagged the parity gap after the stub landed.

Fix shape: add a File arm to the deduped render (RenderableFile gains a description-less file line or reuses the stub text); pin with a deduped-mode seam test per 02-code-standards render-mode rule.

Acceptance: quoting a message whose attachment was an unsupported type renders the [File: name] stub in the quote; no warnOnDroppedEnrichment for File entries.
<!-- SECTION:DESCRIPTION:END -->
