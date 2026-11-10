---
id: TASK-1401
title: >-
  Deduped quote of an audio-only plain webm renders as a bare file while the
  live quote renders a transcript
status: To Do
assignee: []
created_date: '2026-11-10T23:13:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1384000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: an audio-only plain video/webm upload (no voice flag) on a referenced message renders differently on the two quote paths. Live reference: the formatter sniffs the bytes and renders <voice ... source="shared-file"> with a transcript. Deduped reference (the quoted message is already in history): buildDedupedAttachments only reads child-job results, and the gateway plan classifies plain video/webm as file, so no STT job exists; the stub renders <file filename="recording.webm" type="video/webm"/> with no transcript. The orphan arm in ReferencedMessageFormatter.ts (~215-232) that would mark such a webm as shared-file voice is therefore unreachable (doc-117 C2). Code-reading suggests toStoredReference stores the deduped output, so the transcript-less shape is persisted into that turn's stored reference; not runtime-confirmed.
Found by the TASK-1398 chain seam test (cell audio-only-webm x deduped-reference, an it.fails entry tagged with this task).
What: decide one shape for both quote paths. Options: sniff in the deduped path as the live path does (adds a byte fetch for a deduped quote), or render the file honestly on both (drops the live transcript). Structural home: doc-117 phase 2 (attachment-spined preprocessing).
Acceptance: the seam cell flips from it.fails to it; live and deduped quotes of the same message carry the same provenance.
<!-- SECTION:DESCRIPTION:END -->
