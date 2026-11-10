---
id: TASK-1380
title: >-
  Job-path rebuild drops attachment provenance: trigger spoiler, sticker,
  link-preview and voice headers never render
status: Done
assignee: []
created_date: '2026-11-10T02:55:00Z'
updated_date: '2026-11-10T05:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1363000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: DependencyStep.buildPreprocessingResults (services/ai-worker/src/jobs/handlers/pipeline/steps/DependencyStep.ts:418-467) rebuilds every trigger-message ProcessedAttachment from the job result alone: images get metadata {url, name: url basename, contentType image/unknown, size 0}, audio {url, name, contentType audio/unknown, size 0}. isSpoiler, isSticker, isEmbedPreview, isVoiceMessage and duration are all dropped, and nothing re-merges them (DependencyStep.ts:467 is the only producer of processedAttachments; conversationContextBuilder.ts:67-70 and ConversationInputProcessor.ts:151-152 pass it through). So on the normal job path RAGUtils renders [Image: name] for spoilered images, stickers and link previews, and [Audio: name] for genuine voice messages; the shipped provenance headers (457bcae38 / TASK-1053, TASK-804) fire only on the inline fallback. persistTriggerDescriptions (DependencyStep.ts:174-183) persists the same impoverished render into history.

Evidence: code reading (2026-11-09, TASK-813 grounding); 457bcae38 touched RAGUtils/AttachmentProcessor/QuoteFormatter tests with hand-built metadata, not DependencyStep. NOT yet runtime-confirmed: the fix unit opens with a red seam test (real DependencyStep rebuild -> real RAGUtils render, Redis mocked) and stops if it passes on the base.

Fix shape: copy the sibling reference-path mechanism (AttachmentProcessor.ts:520 findPreprocessedByUrl keeps the original AttachmentMetadata and takes only the description): in DependencyStep, join each rebuilt trigger entry to jobContext.attachments by URL and take the original metadata; unmatched entries keep todays shape. No job-result schema change. Check the reference and extended-context arms for the same loss.

Acceptance: a trigger with a spoilered image, a sticker and a voice message renders [Spoiler image: name], [Sticker: name] and [Voice message: Ns] on the job path, persisted history included; seam test pins it. Blocks TASK-813 (its constraint narrowing is only correct once the voice header returns).

Release note: persisted trigger history content changes shape (real filenames instead of URL basenames, provenance headers restored).
<!-- SECTION:DESCRIPTION:END -->
