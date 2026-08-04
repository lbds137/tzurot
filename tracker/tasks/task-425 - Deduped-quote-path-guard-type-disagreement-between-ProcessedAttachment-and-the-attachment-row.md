---
id: TASK-425
title: >-
  Deduped quote path: guard type disagreement between ProcessedAttachment and
  the attachment row
status: To Do
assignee: []
created_date: '2026-08-04 07:41'
updated_date: '2026-08-04 07:42'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 425000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: reviewer hardening note on the TASK-421 fix — the correlated deduped-quote path picks the rendered element kind from the reference rows own contentType/isVoiceMessage (classifyAttachment), while the ProcessedAttachment carries the producers type. With todays single producer (MultimodalProcessor) the two derive from the same contentType and cannot disagree for File; a future producer that types entries differently (e.g. DependencyStep forwarding File stubs, or video processing per doc-59) could render a File stub description under an <image> tag as if it were paid vision output.
Fix shape: at the correlation site in buildDedupedAttachments, when hit.type and classifyAttachment(att) disagree, prefer identity-only rendering and log a warn — or assert the invariant in the producer.
Promote when: DependencyStep (or any new producer) starts emitting AttachmentType.File entries into preprocessedReferenceAttachments.
Acceptance: a type-mismatched entry never renders its description under the wrong element kind.
<!-- SECTION:DESCRIPTION:END -->
