---
id: TASK-813
title: >-
  Uploaded audio files are framed as voice messages, so their transcripts escape
  the provenance constraint
status: To Do
assignee: []
created_date: 2026-08-29 04:41
updated_date: '2026-11-10T05:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 813000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: an uploaded audio file (a song clip, a forwarded voice memo recorded by somebody else) is wrapped in <voice_transcripts><transcript> identically to a genuine Discord voice message. RAGUtils.formatProcessedAttachmentEntry Audio branch (services/ai-worker/src/services/RAGUtils.ts:113-117) applies the same wrapper regardless of isVoiceMessage; only the HEADER differs, via buildAudioAttachmentHeader (RAGUtils.ts:126-138) which emits [Voice message: 5.2s] when isVoiceMessage is true and duration is positive, else [Audio: name].

This matters because the TASK-804 provenance constraint in OUTPUT_CONSTRAINTS deliberately EXCLUDES voice, on the reasoning that an STT transcript is the speech of the person who sent it. That reasoning holds for a genuine voice message and fails for an uploaded audio file, where the transcript is a transcription of media the sender merely shared. So the misattribution class TASK-804 fixed for images survives here: a character can credit the sender with the wording of a song clip or of somebody else recording. Surfaced by claude-review on PR 2248, which correctly scoped it out of that PR.

Fix shape: the header already carries the distinction, so no render change is strictly needed. Prefer (a) extend the provenance constraint to name the [Audio: name] header form specifically - a transcript under that header is a transcription of a file the sender shared, not their own speech - because it is one clause on an S0-cacheable line. Alternative (b) wrap non-voice-message audio in a distinct element so the two cases are structurally separable, which is heavier and touches the escaping seam.

CARE: the constraint currently asserts voice is excluded and a test pins that exclusion (HardcodedConstraints.test.ts, the excludes-voice-transcripts case, with the reason in a comment above it). Option (a) narrows that exclusion to GENUINE voice messages, so the test, its name, and its comment must move together with the constraint or the pin will contradict the code.

Second site (TASK-1116, PR 2548): in the reference/quote path (`AttachmentProcessor.processPlainFileAttachment`, `QuoteFormatter.renderableFor`) a transcribed plain audio-only `video/webm` renders as a `<voice>` element with no duration, the same element a genuine voice message gets; that path has no `[Audio: name]` header to carry the distinction. Option (a) alone does not reach it; the fix needs a marker on the quote element (e.g. a missing duration or an explicit uploaded-file attribute) that the constraint can name.

Acceptance: a character receiving an uploaded audio file does not credit the sender with the wording of the transcript, while a genuine voice message still reads as that person own speech; both states pinned by tests, and the voice-exclusion comment updated to match the narrowed reasoning.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grounding 2026-11-09 (code reading, not runtime-confirmed): the fix shape premise "the header already carries the distinction" does NOT hold on the main trigger path. DependencyStep.fetchAudioResult (DependencyStep.ts:216-234) keeps url/name/content only, and the rebuild at DependencyStep.ts:446-455 sets no isVoiceMessage and no duration (AudioTranscriptionResult, packages/common-types/src/types/jobs.ts:325-343, carries no flag). So buildAudioAttachmentHeader (RAGUtils.ts:160-171) emits [Audio: name] for a GENUINE voice message too; [Voice message: Ns] appears only on the inline fallback (ConversationInputProcessor.ts:157). Option (a) alone would therefore disclaim real voice messages.

Revised fix shape (size M): (1) carry isVoiceMessage + duration from the audio job (api-gateway jobChainOrchestrator.ts:45-58 knows the flag) through AudioTranscriptionResult into the DependencyStep rebuild, so voice messages get their [Voice message: Ns] header back; red-first seam test over the real DependencyStep -> RAGUtils chain; (2) narrow the provenance constraint to name the [Audio: name] / [Spoiler audio: name] transcript as shared media, moving the excludes-voice test (HardcodedConstraints.test.ts:201-207) with it; (3) quote path: a plain audio-only video/webm with a transcript renders <voice> (QuoteFormatter.ts:233-236) - add an uploaded-file marker the constraint names. Also correct the RAGUtils.ts:79-90 doc comment.

Unrelated suspects from the same trace, filed separately: TASK-1378 (row content re-wrapped as a transcript), TASK-1379 (audio silently absent beside other preprocessed attachments). Uploaded mp3 in a QUOTE is never transcribed (jobChainOrchestrator.ts:255-270 transcribes only voice for references) - deliberate today, so not part of this unit.

CORRECTION same day: step (1) of the revised fix shape above (carry isVoiceMessage + duration through AudioTranscriptionResult) is superseded. The loss is a class across images and audio, filed as TASK-1380, fixed by a URL join in DependencyStep that copies the reference-path sibling (AttachmentProcessor.ts:520), with no job-result schema change. TASK-813 now depends on TASK-1380 and keeps steps (2) constraint narrowing and (3) quote-path webm marker.
<!-- SECTION:NOTES:END -->
