---
id: TASK-378
title: Align message-level media vocabulary with the quote-level <attachments> shape
status: To Do
assignee: []
created_date: '2026-07-31 12:21'
updated_date: '2026-07-31 12:21'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 378000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: quote-level media now renders as one `<attachments>` section with per-modality `<image>/<voice>/<file>` elements carrying a `status` when enrichment is absent. MESSAGE level still emits the old split — `formatImageSection` -> `<image_descriptions>`, `formatVoiceSection` -> `<voice_transcripts>` (xmlMetadataFormatters), plus RAGUtils wrapping memory transcripts in `<voice_transcripts><transcript>`. Leaving them recreates at the message level exactly the inconsistency the quote level just removed, and the owner's vocabulary constraint was "as long as it is consistent".

What: move message-level sections to the same `<attachments>` vocabulary; decide RAGUtils separately (memory entries are a different surface and may want to keep a distinct wrapper).

Why not done with the quote level: it is the widest model-visible surface in the prompt (every history message, over persisted metadata), so it gets its own decision and its own revert handle rather than riding along.

Acceptance: one media vocabulary across quote and message level; `guard:prompt-tags` still classifies every emitted tag; conversationLengthEstimator updated in the same change.
<!-- SECTION:DESCRIPTION:END -->
