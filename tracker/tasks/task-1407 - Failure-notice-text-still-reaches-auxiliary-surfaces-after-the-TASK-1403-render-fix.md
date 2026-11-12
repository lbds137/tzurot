---
id: TASK-1407
title: >-
  Failure-notice text still reaches auxiliary surfaces after the TASK-1403
  render fix
status: To Do
assignee: []
created_date: '2026-11-12T00:37:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1388000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-1403 render fix stops failure notices persisting inside voice_transcripts on the live render and persisted trigger row, but two auxiliary surfaces still present the notice as if it were speech. DiagnosticCollector around line 120 reports a failed audio notice under the voiceTranscript diagnostics field; extractContentDescriptions in RAGUtils embeds the notice text into memory search queries (BARE_PLACEHOLDERS filters only bare placeholders). What: now that ProcessedAttachment carries processingFailed on failure rows, use it in both surfaces — a null or separately labeled diagnostics field, and failure descriptions filtered from search queries the way bare placeholders are. Acceptance: a failed-voice turn shows no notice under the voiceTranscript diagnostics field, and the notice text does not ride search queries.
<!-- SECTION:DESCRIPTION:END -->
