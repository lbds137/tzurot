---
id: TASK-1403
title: >-
  Failure notices persist into history inside voice_transcripts and read as
  speech on replay
status: To Do
assignee: []
created_date: '2026-11-11T03:23:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1385000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a failed transcription renders as an Audio entry whose description is the notice (Audio transcription failed (reason)), both from the inline retry-failure fallback (MultimodalProcessor.ts ~384-401) and from the trigger failure stubs (triggerAttachmentMerge.ts buildFailureStub, PR for TASK-1395). buildAttachmentDescriptions (RAGUtils.ts ~153-156) wraps every Audio description in <voice_transcripts><transcript>, and visionDescriptionWriter persists that text onto the trigger row, so on replay the notice sits where spoken words go. BARE_PLACEHOLDERS (RAGUtils.ts:46) does not cover it. Found by the TASK-1395 pre-PR review (code-reading, not runtime-confirmed).
What: render a failure entry with its header and the notice outside the transcript wrapper (or mark it and skip the wrapper), in both the live render and the persisted copy; the label OUTPUT_CONSTRAINTS uses must still apply.
Acceptance: a test shows a failed voice message renders [Voice message: Ns] plus the notice with no <transcript> element, live and persisted.
<!-- SECTION:DESCRIPTION:END -->
