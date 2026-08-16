---
id: TASK-629
title: Image-only referenced messages render a contentless dedup stub
status: Done
assignee: []
created_date: '2026-08-16 19:09'
updated_date: '2026-08-16 23:07'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 629000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod observation (requestId f6f73154, 2026-08-16): a reply to a forwarded image-only message rendered its contextual-reference stub with zero anchoring content — the preview is text-derived and the message has no text, and attachment descriptions are not stubbed. The model found the full description anyway because the referenced message was the immediately-preceding chat_log entry, but a reference further back would reproduce the d3c643f0-class miss for image-only messages. Worse, the reference legend states media "appears only in the quote itself" — false on the dedup path, where the media description lives only in the chat_log copy.

Fix shape: in the dedup-stub path (RenderableReference), when the referenced message has no text but has attachment descriptions, include a truncated (~100 char) attachment description in the stub — the media analog of the assistant-preview fix that shipped in the reply-preview PR. Reconcile the legend sentence with actual dedup behavior. Owner suggested the truncated-description shape unprompted.

Acceptance: image-only referenced message stubs carry a truncated media description; the legend matches both stub modes; test matrix covers (image-only x deduped) per the ReferencedMessageFormatter mode-coverage rule.
<!-- SECTION:DESCRIPTION:END -->
