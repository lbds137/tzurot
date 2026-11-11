---
id: TASK-1398
title: Attachment-provenance chain seam test plus a shared preprocessing plan
status: Done
assignee: []
created_date: '2026-11-10T14:30:00Z'
updated_date: '2026-11-11T02:02:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1381000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: provenance routing is decided in api-gateway (categorizeAttachments, audioWorthTranscribing in jobChainOrchestrator.ts) while ai-worker renderers encode assumptions about it, and its inline path routes differently (MultimodalProcessor.ts ~264-304). TASK-1384 shipped a wrong premise for exactly this reason. No test runs the real chain.
What: (1) move the two gateway functions into common-types as a pure planPreprocessing(attachments, opts) used by the gateway and the inline path; (2) one table-driven ai-worker seam test: {voice, Vencord webm voice, mp3 upload, audio-only webm, spoiler image, sticker, link preview, pdf} x {trigger job path, trigger inline, live reference, deduped reference, stored replay}, real plan + DependencyStep + renderers, Redis stubbed; assert every attachment is visible and every emitted label appears in OUTPUT_CONSTRAINTS.
This is phase 1 of the provenance redesign doc; expect it red on the base for TASK-1379 and the D1/D2 tasks. Found by the Fable attachment-provenance review 2026-11-10 (Option 3).
<!-- SECTION:DESCRIPTION:END -->
