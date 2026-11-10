---
id: doc-117
title: 'Idea: attachment-provenance redesign (attachment-spined preprocessing)'
type: specification
created_date: '2026-11-10T14:31:00Z'
---

# Attachment-provenance redesign

Source: Fable read-only architecture review, 2026-11-10, at develop 5c6c4c474. Citations below are the review's (code-reading). The driver checked the D1/D2 sites. Motivation: TASK-804, 1053, 1380, 813, 1381, 1383 and 1384 (Done) and TASK-1378, 1379 and 842 (open) all sit on this one seam.

## Structural causes

- **C1: enrichment is the spine and the attachment is the lookup.**
  - Child job results keep only the URL and text (`AudioTranscriptionJob.ts` ~158, `ImageDescriptionJob.ts` ~231/253/366, result type in `packages/common-types/src/types/jobs.ts` ~237).
  - `DependencyStep.ts` (~488-547) rebuilds entries with `*/unknown`, `size: 0` and a URL-basename name, then re-joins metadata by URL (~72-107), for the trigger only.
  - References re-join separately (`AttachmentProcessor.ts` ~276, `ReferencedMessageFormatter.ts` ~179), and so does the stored path (`storedReference.ts` ~141).
  - Produced: 1380, 1381, 1383, 1379, TASK-1395 and TASK-1396.
- **C2: routing is decided in api-gateway, and ai-worker renderers assume it.**
  - The gateway decides with `categorizeAttachments` and `audioWorthTranscribing` (`jobChainOrchestrator.ts`).
  - The inline path routes differently (`MultimodalProcessor.ts` ~264-304).
  - Produced: 1384's premise error and the unreachable `video/webm` orphan arm.
- **C3: two classification rules.**
  - The bracket rule is `RAGUtils.ts` ~167-183; the XML rule is `classifyAttachment` in `QuoteFormatter.ts`; bot-client has its own.
  - Labels are shared, but the decision of which label applies is not.
  - Produced: 804, 1053, 813, 1383, and the deliberate zero-duration divergence.
- **C4: rendered text is persisted as data.** `visionDescriptionWriter.ts` overwrites the trigger row's content. Produced: 1378 and 842.
- **C5: placeholder values are legal values.** `audio/unknown` and `size: 0` type-check as real metadata.

There are ten model-facing renderers. `OUTPUT_CONSTRAINTS` (`HardcodedConstraints.ts` ~124-125) names the vocabulary of only three of them.

## Phases (order)

1. **Harness: TASK-1398.** A shared pure `planPreprocessing()` in common-types, plus one table-driven chain seam test (attachment kinds × trigger job / trigger inline / live reference / deduped reference / stored replay). It asserts that every attachment is visible and that every emitted label is named in `OUTPUT_CONSTRAINTS`.
2. **Attachment-spined preprocessing (M).**
   - Child results echo `attachment: AttachmentMetadata` (type and Zod schema).
   - DependencyStep iterates the original attachments (trigger and each reference). Each one's enrichment is either present or a named status. The key is `id`, with URL as the fallback.
   - Delete `restoreOriginalMetadata`, the `*/unknown` placeholders, the basename name, and the all-or-nothing preprocessed branch in `ConversationInputProcessor.ts`.
   - Open check: whether sticker and embed producers set `id`.
   - In-flight jobs at deploy lack the field: fail them, or accept one deploy window. No shim.
3. **One classification (M).**
   - `describeProvenance(metadata, enrichment?)` in `attachmentProvenance.ts` returns `{ kind: image | voice-message | shared-audio | file, source, spoiler, durationSeconds, displayName }`.
   - Both the bracket and the XML renderers consume it, and `HEADER_LABELS` is generated from the same table.
   - The zero-duration divergence becomes one explicit line or goes away.
4. **Persist structure, not rendered text (L, highest risk, last).**
   - Per-attachment enrichment is stored, with a provenance slot, and the content stays the user's text. History renders through phase 3's renderer.
   - Retires the content overwrite and `legacyAttachmentLines`.
   - Closes 1378 and 842.
   - Changes stored message shapes: confirm the user-visible semantics with the owner before building.

## Members

TASK-1395 (D1), TASK-1396 (D2), TASK-1397 (D3/D4), TASK-1398 (phase 1); open TASK-1378, TASK-1379, TASK-842; related TASK-1385 (log fields).
